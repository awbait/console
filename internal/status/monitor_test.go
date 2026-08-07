package status

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"
)

// scriptedProbe answers with the next error from a fixed script on each call,
// repeating the last one once the script runs out.
type scriptedProbe struct {
	mu   sync.Mutex
	errs []error
	i    int
}

func (s *scriptedProbe) check(context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.errs[s.i]
	if s.i < len(s.errs)-1 {
		s.i++
	}
	return e
}

// newTestMonitor builds a monitor over one scripted probe, with a frozen clock
// and a logger writing into buf.
func newTestMonitor(buf *bytes.Buffer, errs ...error) (*Monitor, *time.Time) {
	p := &scriptedProbe{errs: errs}
	log := slog.New(slog.NewJSONHandler(buf, &slog.HandlerOptions{Level: slog.LevelInfo}))
	m := NewMonitor(time.Hour, log, Probe{Name: "harbor", Kind: "integration", Mode: "real", Check: p.check})
	clock := time.Unix(0, 0)
	m.now = func() time.Time { return clock }
	return m, &clock
}

// one returns the single component's state.
func one(t *testing.T, m *Monitor) ComponentState {
	t.Helper()
	got := m.Snapshot()
	if len(got) != 1 {
		t.Fatalf("snapshot has %d components, want 1", len(got))
	}
	return got[0]
}

// TestMonitorStartsOK asserts an unprobed monitor does not accuse the platform
// of being broken before it has looked.
func TestMonitorStartsOK(t *testing.T) {
	var buf bytes.Buffer
	m, _ := newTestMonitor(&buf, nil)
	st := one(t, m)
	if !st.OK || !st.CheckedAt.IsZero() {
		t.Fatalf("fresh monitor: %+v, want OK with no probe time", st)
	}
}

// TestMonitorDebouncesSingleFailure walks ok -> fail -> fail -> ok: one failed
// probe must not take the component down (the order button would flicker), two
// in a row must, and a single success brings it straight back.
func TestMonitorDebouncesSingleFailure(t *testing.T) {
	boom := errors.New("harbor: dial tcp: i/o timeout")
	var buf bytes.Buffer
	m, clock := newTestMonitor(&buf, nil, boom, boom, nil)
	ctx := context.Background()

	m.tick(ctx) // ok
	if st := one(t, m); !st.OK {
		t.Fatalf("after a successful probe: %+v, want OK", st)
	}

	*clock = clock.Add(time.Minute)
	m.tick(ctx) // first failure: still up, but counted
	st := one(t, m)
	if !st.OK || st.Fails != 1 {
		t.Fatalf("after one failure: %+v, want OK with fails=1", st)
	}

	*clock = clock.Add(time.Minute)
	m.tick(ctx) // second failure: down
	st = one(t, m)
	if st.OK || st.Err != boom.Error() {
		t.Fatalf("after two failures: %+v, want down with the probe error", st)
	}
	if !st.Since.Equal(*clock) {
		t.Fatalf("Since = %v, want the moment it went down (%v)", st.Since, *clock)
	}

	*clock = clock.Add(time.Minute)
	m.tick(ctx) // recovered
	st = one(t, m)
	if !st.OK || st.Fails != 0 || st.Err != "" {
		t.Fatalf("after recovery: %+v, want OK with no error", st)
	}
}

// TestMonitorLogsOnEdgeOnly asserts a long outage logs one warning, not one per
// tick, and recovery logs once.
func TestMonitorLogsOnEdgeOnly(t *testing.T) {
	boom := errors.New("harbor: HTTP 502")
	var buf bytes.Buffer
	m, clock := newTestMonitor(&buf, boom, boom, boom, boom, nil)
	for range 5 {
		m.tick(context.Background())
		*clock = clock.Add(time.Minute)
	}

	out := buf.String()
	if got := strings.Count(out, "component down"); got != 1 {
		t.Fatalf(`"component down" logged %d times, want 1 (edge only)`+"\n%s", got, out)
	}
	if got := strings.Count(out, "component recovered"); got != 1 {
		t.Fatalf(`"component recovered" logged %d times, want 1 (edge only)`+"\n%s", got, out)
	}
	if strings.Contains(out, "component probe ok") || strings.Contains(out, "component probe failed") {
		t.Fatalf("debug-level lines leaked at info level:\n%s", out)
	}
}

// TestMonitorSnapshotDuringTick runs Snapshot against a live Run loop; the point
// is the race detector, not the returned value.
func TestMonitorSnapshotDuringTick(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	log := slog.New(slog.NewJSONHandler(&bytes.Buffer{}, nil))
	m := NewMonitor(time.Millisecond, log, Probe{
		Name: "gitlab", Kind: "integration", Mode: "real",
		Check: func(context.Context) error { return nil },
	})

	done := make(chan struct{})
	go func() {
		defer close(done)
		m.Run(ctx)
	}()
	for range 200 {
		if got := m.Snapshot(); len(got) != 1 {
			t.Errorf("snapshot has %d components, want 1", len(got))
			break
		}
	}
	cancel()
	<-done
}

// TestMonitorProbesRunConcurrently asserts one wedged probe does not serialise
// the tick behind it: both probes must be in flight at the same time.
func TestMonitorProbesRunConcurrently(t *testing.T) {
	entered := make(chan struct{}, 2)
	release := make(chan struct{})
	block := func(context.Context) error {
		entered <- struct{}{}
		<-release
		return nil
	}
	log := slog.New(slog.NewJSONHandler(&bytes.Buffer{}, nil))
	m := NewMonitor(time.Hour, log,
		Probe{Name: "harbor", Kind: "integration", Check: block},
		Probe{Name: "gitlab", Kind: "integration", Check: block},
	)

	done := make(chan struct{})
	go func() {
		defer close(done)
		m.tick(context.Background())
	}()
	for range 2 {
		select {
		case <-entered:
		case <-time.After(2 * time.Second):
			t.Fatal("probes did not run concurrently")
		}
	}
	close(release)
	<-done
}
