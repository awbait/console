package leader

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"
)

// fakeLease is a lease nobody else can see, driven by the test: whether it is
// ours, and whether asking works at all.
type fakeLease struct {
	mu sync.Mutex
	// held is who holds the lease: "" for nobody, "us" for this replica.
	held string
	// err is what every call answers with while it is set, standing for a
	// backend that is unreachable.
	err error

	takes, keeps, releases int
}

func (l *fakeLease) Take(context.Context, time.Duration) (bool, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.takes++
	if l.err != nil {
		return false, l.err
	}
	if l.held != "" {
		return false, nil
	}
	l.held = "us"
	return true, nil
}

func (l *fakeLease) Keep(context.Context, time.Duration) (bool, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.keeps++
	if l.err != nil {
		return false, l.err
	}
	return l.held == "us", nil
}

func (l *fakeLease) Release(context.Context) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.releases++
	if l.err != nil {
		return l.err
	}
	if l.held == "us" {
		l.held = ""
	}
	return nil
}

func (l *fakeLease) set(held string, err error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.held, l.err = held, err
}

// election builds an election on a stopped clock the test moves itself.
func election(lease Lease) (*Election, *time.Time) {
	clock := time.Unix(1_700_000_000, 0)
	e := New(lease, slog.New(slog.NewTextHandler(io.Discard, nil)))
	e.TTL = 30 * time.Second
	e.now = func() time.Time { return clock }
	return e, &clock
}

func TestTakesTheLeaseWhenItIsFree(t *testing.T) {
	lease := &fakeLease{}
	e, _ := election(lease)

	if e.IsLeader() {
		t.Fatal("leading before the first round: nothing has been claimed yet")
	}
	e.Step(context.Background())
	if !e.IsLeader() {
		t.Fatal("not leading after taking a free lease")
	}
}

func TestStandsByWhileAnotherReplicaHoldsTheLease(t *testing.T) {
	lease := &fakeLease{held: "them"}
	e, _ := election(lease)

	e.Step(context.Background())
	if e.IsLeader() {
		t.Fatal("leading while another replica holds the lease")
	}

	// The other replica goes away and the lease is free at the next round.
	lease.set("", nil)
	e.Step(context.Background())
	if !e.IsLeader() {
		t.Fatal("not leading after the lease was released")
	}
}

func TestLeadershipRunsOutWithTheLease(t *testing.T) {
	lease := &fakeLease{}
	e, clock := election(lease)
	e.Step(context.Background())

	// A renewal is due long before the lease is: leadership survives it.
	*clock = clock.Add(20 * time.Second)
	if !e.IsLeader() {
		t.Fatal("stopped leading before the lease ran out")
	}
	// Nothing renewed it, so the moment it would have expired it is gone - even
	// though the loop has not run a round since.
	*clock = clock.Add(11 * time.Second)
	if e.IsLeader() {
		t.Fatal("still leading past the end of the lease")
	}
}

func TestKeepsTheLeaseWhileTheBackendIsUnreachable(t *testing.T) {
	lease := &fakeLease{}
	e, clock := election(lease)
	e.Step(context.Background())

	lease.set("us", errors.New("dial tcp: connection refused"))

	// Two failed renewals inside one lease: still ours, because no other replica
	// can take a key that has not expired.
	*clock = clock.Add(10 * time.Second)
	e.Step(context.Background())
	*clock = clock.Add(10 * time.Second)
	e.Step(context.Background())
	if !e.IsLeader() {
		t.Fatal("gave up the lease while it was still valid")
	}

	// Past the expiry there is no way to know whether it is still ours, so it
	// is given up.
	*clock = clock.Add(11 * time.Second)
	e.Step(context.Background())
	if e.IsLeader() {
		t.Fatal("still leading after the lease expired unrenewed")
	}
}

func TestStepsDownWhenTheLeaseIsTakenOver(t *testing.T) {
	lease := &fakeLease{}
	e, clock := election(lease)
	e.Step(context.Background())

	// Somebody else holds it now: the renewal says no, and the take that follows
	// finds it occupied.
	lease.set("them", nil)
	*clock = clock.Add(10 * time.Second)
	e.Step(context.Background())

	if e.IsLeader() {
		t.Fatal("still leading after the lease was taken over")
	}
	if lease.takes == 0 {
		t.Fatal("did not try to take the lease back after losing it")
	}
}

func TestHandsTheLeaseBackOnShutdown(t *testing.T) {
	lease := &fakeLease{}
	e, _ := election(lease)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		e.Run(ctx)
	}()

	// Run claims the lease before its first tick.
	waitFor(t, e.IsLeader, "the first round to claim the lease")

	cancel()
	<-done

	if e.IsLeader() {
		t.Fatal("still leading after shutdown")
	}
	lease.mu.Lock()
	defer lease.mu.Unlock()
	if lease.releases == 0 {
		t.Fatal("the lease was not handed back, so another replica waits out its whole term")
	}
	if lease.held != "" {
		t.Fatalf("the lease is still held by %q after shutdown", lease.held)
	}
}

func TestSoloAlwaysLeads(t *testing.T) {
	if !Solo().IsLeader() {
		t.Fatal("a portal with nothing to share must run its own background loops")
	}
}

// waitFor polls cond until it holds, for the one test that runs the loop rather
// than stepping it.
func waitFor(t *testing.T, cond func() bool, what string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}
