package status

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// scriptedReconciler returns the next error from a fixed script on each call.
type scriptedReconciler struct {
	errs []error
	i    int
}

func (s *scriptedReconciler) Reconcile(context.Context) error {
	e := s.errs[s.i]
	if s.i < len(s.errs)-1 {
		s.i++
	}
	return e
}

// TestPollerLogsOnEdgeOnly drives a reconciler through ok -> fail -> fail -> ok
// and asserts the poller logs the WARN/INFO edges once, not every tick.
func TestPollerLogsOnEdgeOnly(t *testing.T) {
	boom := errors.New("gitlab: status 502")
	rec := Named("import", &scriptedReconciler{errs: []error{nil, boom, boom, boom, nil}})

	var buf bytes.Buffer
	log := slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo}))
	p := NewPoller(time.Hour, log, rec)
	// Advance the clock well past any backoff before each tick, so the reconciler
	// runs every tick (this test exercises edge-logging, not backoff).
	clock := time.Unix(0, 0)
	p.now = func() time.Time { return clock }

	for range 5 {
		p.tick(context.Background())
		clock = clock.Add(24 * time.Hour)
	}

	out := buf.String()
	if got := strings.Count(out, "reconcile failing"); got != 1 {
		t.Fatalf(`"reconcile failing" logged %d times, want 1 (edge only)`+"\n%s", got, out)
	}
	if got := strings.Count(out, "reconcile recovered"); got != 1 {
		t.Fatalf(`"reconcile recovered" logged %d times, want 1 (edge only)`+"\n%s", got, out)
	}
	// At info level the repeated-failure and steady-ok debug lines stay silent.
	if strings.Contains(out, "reconcile still failing") || strings.Contains(out, "reconcile ok") {
		t.Fatalf("debug-level lines leaked at info level:\n%s", out)
	}
}

func TestBackoffFor(t *testing.T) {
	const iv = 10 * time.Second
	cases := []struct {
		failures int
		want     time.Duration
	}{
		{0, 0},
		{1, iv},
		{2, 2 * iv},
		{3, 4 * iv},
		{100, backoffMax}, // overflow / cap
	}
	for _, c := range cases {
		if got := backoffFor(iv, c.failures); got != c.want {
			t.Errorf("backoffFor(%v, %d) = %v, want %v", iv, c.failures, got, c.want)
		}
	}
}

// TestPollerBacksOff: a persistently-failing reconciler is skipped while in
// backoff and retried once the (controlled) clock passes nextAttempt.
func TestPollerBacksOff(t *testing.T) {
	rec := &countingReconciler{err: errors.New("boom")}
	log := slog.New(slog.NewJSONHandler(&bytes.Buffer{}, &slog.HandlerOptions{Level: slog.LevelError}))
	p := NewPoller(time.Minute, log, Named("x", rec))
	clock := time.Unix(0, 0)
	p.now = func() time.Time { return clock }

	p.tick(context.Background()) // runs, fails -> backoff 1m
	if rec.calls != 1 {
		t.Fatalf("first tick should run, calls=%d", rec.calls)
	}
	clock = clock.Add(30 * time.Second) // still within 1m backoff
	p.tick(context.Background())
	if rec.calls != 1 {
		t.Fatalf("tick within backoff must skip, calls=%d", rec.calls)
	}
	clock = clock.Add(31 * time.Second) // now past the 1m backoff
	p.tick(context.Background())
	if rec.calls != 2 {
		t.Fatalf("tick after backoff must run, calls=%d", rec.calls)
	}
}

type countingReconciler struct {
	err   error
	calls int
}

func (c *countingReconciler) Reconcile(context.Context) error {
	c.calls++
	return c.err
}

// atomicReconciler counts calls atomically so the Run goroutine and the test
// goroutine can read the count without a data race.
type atomicReconciler struct{ calls atomic.Int64 }

func (a *atomicReconciler) Reconcile(context.Context) error {
	a.calls.Add(1)
	return nil
}

// TestPollerTriggerRunsTick: with a long interval the only ticks come from the
// initial start sweep and from Trigger, so a Trigger must advance the count.
func TestPollerTriggerRunsTick(t *testing.T) {
	rec := &atomicReconciler{}
	log := slog.New(slog.NewJSONHandler(&bytes.Buffer{}, &slog.HandlerOptions{Level: slog.LevelError}))
	p := NewPoller(time.Hour, log, Named("x", rec))

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { p.Run(ctx); close(done) }()

	waitFor(t, func() bool { return rec.calls.Load() >= 1 }) // start sweep
	p.Trigger("test")
	waitFor(t, func() bool { return rec.calls.Load() >= 2 }) // triggered sweep

	cancel()
	<-done
}

// TestPollerWebhookOnlyNoPeriodicTick: with interval <= 0 the poller runs the
// startup sweep and reacts to Trigger, but never ticks on its own.
func TestPollerWebhookOnlyNoPeriodicTick(t *testing.T) {
	rec := &atomicReconciler{}
	log := slog.New(slog.NewJSONHandler(&bytes.Buffer{}, &slog.HandlerOptions{Level: slog.LevelError}))
	p := NewPoller(0, log, Named("x", rec)) // interval 0: webhook-only

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { p.Run(ctx); close(done) }()

	waitFor(t, func() bool { return rec.calls.Load() == 1 }) // startup sweep only
	// No ticker: give it room to (wrongly) fire, then assert it did not.
	time.Sleep(50 * time.Millisecond)
	if got := rec.calls.Load(); got != 1 {
		t.Fatalf("webhook-only poller ticked on its own: calls=%d, want 1", got)
	}
	p.Trigger("webhook")
	waitFor(t, func() bool { return rec.calls.Load() == 2 })

	cancel()
	<-done
}

// TestTriggerNonBlockingAndNilSafe: Trigger never blocks even with no consumer
// (buffered, coalescing) and a nil poller is a no-op.
func TestTriggerNonBlockingAndNilSafe(t *testing.T) {
	var np *Poller
	np.Trigger("nil is a no-op") // must not panic

	p := NewPoller(time.Hour, slog.Default())
	p.Trigger("a")
	p.Trigger("b") // buffer full; must coalesce, not block
	p.Trigger("c")
}

// TestStandbyReplicaDoesNotReconcile: a replica that does not hold the lease
// runs nothing, not even the sweep a webhook asked for. The leader was told
// about that webhook too, and it is the one that would advance the order.
func TestStandbyReplicaDoesNotReconcile(t *testing.T) {
	rec := &countingReconciler{}
	p := NewPoller(time.Hour, slog.Default(), Named("provisioning", rec))
	leading := false
	p.SetLeader(func() bool { return leading })

	p.tick(context.Background())
	p.Trigger("gitlab: merge request merged")
	p.tick(context.Background())
	if got := rec.calls; got != 0 {
		t.Fatalf("a standby replica reconciled %d times, want 0", got)
	}
	if got := p.Snapshot(); len(got) != 0 {
		t.Fatalf("a standby replica reported %d loops of its own, want none: %+v", len(got), got)
	}

	// The lease moves here: the same poller now does the work.
	leading = true
	p.tick(context.Background())
	if got := rec.calls; got != 1 {
		t.Fatalf("reconciled %d times after taking the lease, want 1", got)
	}
	if got := p.Snapshot(); len(got) != 1 {
		t.Fatalf("reported %d loops after taking the lease, want 1", len(got))
	}
}

// TestPollerWithoutAnElectorAlwaysRuns: a single replica has nobody to defer to.
func TestPollerWithoutAnElectorAlwaysRuns(t *testing.T) {
	rec := &countingReconciler{}
	p := NewPoller(time.Hour, slog.Default(), Named("provisioning", rec))

	p.tick(context.Background())
	if got := rec.calls; got != 1 {
		t.Fatalf("reconciled %d times with no elector wired, want 1", got)
	}
}

// waitFor polls cond up to ~2s, failing the test if it never holds.
func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("condition not met within timeout")
}
