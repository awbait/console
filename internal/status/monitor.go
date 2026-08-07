package status

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"console/internal/observability"
)

// Probe is one component health check: who is being checked and how. The set is
// built at wiring time (see api.Server.probes) from the upstream ports and the
// storage backends.
type Probe struct {
	Name  string // keycloak|harbor|gitlab|argocd|store|cache
	Kind  string // "integration" | "storage"
	Mode  string // integration: fake|real|oidc|dev; storage: backend name
	URL   string // external UI link (integrations only)
	Check func(context.Context) error
}

// probeTimeout bounds a single check so one wedged upstream cannot hold up the
// tick (probes run concurrently, but the tick still waits for all of them).
const probeTimeout = 5 * time.Second

// downThreshold is how many consecutive failures make a component "down" for
// the portal. One failure is not enough on purpose: a single timeout would
// otherwise disable the order button and raise a banner for a few seconds, and
// a flapping upstream would flip the whole UI back and forth. Recovery is
// immediate - a single success brings the component back.
const downThreshold = 2

// recheckDelay is how soon a first failure is confirmed. Waiting a whole
// interval for the second opinion would make the debounce cost the user a full
// poll cycle before anything is said on screen; a few seconds is long enough to
// rule out a blip and short enough that the banner still feels like a reaction
// to what just happened. It also throttles Trigger, so a burst of failing
// requests cannot make the monitor probe in a loop.
const recheckDelay = 2 * time.Second

// ComponentState is the current health of one component. Err carries the last
// probe error and is meant for platform admins only - the product UI speaks in
// terms of capabilities (see capabilities.go), never in upstream errors.
type ComponentState struct {
	Name      string
	Kind      string
	Mode      string
	URL       string
	OK        bool
	Err       string
	Fails     int       // consecutive failures; a component is down at downThreshold
	CheckedAt time.Time // when the last probe ran; zero until the first tick
	Since     time.Time // when OK last changed; zero while it has never changed
}

// Monitor probes every platform component on an interval and keeps the latest
// result in memory. Everything that reports health - the admin status page, the
// public health endpoint, the Prometheus gauges - reads that one snapshot, so
// the upstreams see a fixed probe rate no matter how many people are looking.
type Monitor struct {
	interval time.Duration
	probes   []Probe
	log      *slog.Logger

	// mu guards the fields below: the tick writes them from the Run goroutine,
	// Snapshot and Trigger touch them from HTTP handler goroutines.
	mu     sync.Mutex
	states map[string]ComponentState
	// asked records an out-of-band probe request (Trigger) that has not run yet.
	asked bool
	// lastTick is when the last probe round finished, the floor Run counts the
	// next early probe from.
	lastTick time.Time

	now func() time.Time // clock, injectable in tests
}

// NewMonitor builds a monitor over the given probes. Until the first tick every
// component reports OK: the portal must not accuse the platform of being broken
// before it has looked, and the first tick runs the moment Run starts.
func NewMonitor(interval time.Duration, log *slog.Logger, probes ...Probe) *Monitor {
	m := &Monitor{
		interval: interval,
		probes:   probes,
		log:      log,
		states:   make(map[string]ComponentState, len(probes)),
		now:      time.Now,
	}
	for _, p := range probes {
		m.states[p.Name] = ComponentState{Name: p.Name, Kind: p.Kind, Mode: p.Mode, URL: p.URL, OK: true}
	}
	return m
}

// Snapshot returns the current state of every component, in probe order. Safe to
// call concurrently with Run.
func (m *Monitor) Snapshot() []ComponentState {
	if m == nil {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]ComponentState, 0, len(m.probes))
	for _, p := range m.probes {
		out = append(out, m.states[p.Name])
	}
	return out
}

// Trigger asks for a probe round sooner than the next tick, for the moment a
// real request has just failed against an upstream: the user is already looking
// at the failure, so the portal should not need another poll cycle to admit it.
// Non-blocking, safe to call concurrently and from any handler; requests
// coalesce and are throttled to one round per recheckDelay, so a burst of failed
// requests cannot turn into a probe loop. A nil monitor is a no-op.
func (m *Monitor) Trigger(reason string) {
	if m == nil {
		return
	}
	m.mu.Lock()
	already := m.asked
	m.asked = true
	m.mu.Unlock()
	if !already {
		m.log.Debug("health probe requested", "reason", reason)
	}
}

// Run blocks, probing once immediately and then on every tick, until the context
// is cancelled. Between ticks it probes early in two cases: a component failed
// its last probe but has not reached downThreshold yet (the second opinion that
// confirms or clears an outage), and a caller asked via Trigger. Single-replica
// MVP, so it runs in-process like the poller.
func (m *Monitor) Run(ctx context.Context) {
	t := time.NewTicker(m.interval)
	defer t.Stop()
	m.tick(ctx)
	for {
		// A nil channel blocks forever in select, so "no early probe due" needs
		// no separate branch. The timer is stopped on every path out of the
		// select: it must not outlive the iteration that created it.
		var early <-chan time.Time
		var timer *time.Timer
		if d, ok := m.earlyProbeIn(); ok {
			timer = time.NewTimer(d)
			early = timer.C
		}
		select {
		case <-ctx.Done():
			stop(timer)
			return
		case <-t.C:
			stop(timer)
			m.tick(ctx)
		case <-early:
			m.tick(ctx)
		}
	}
}

// stop halts a timer that may not exist (no early probe was scheduled).
func stop(t *time.Timer) {
	if t != nil {
		t.Stop()
	}
}

// earlyProbeIn reports how long until the next out-of-band probe, if one is due:
// an unconfirmed failure to double-check, or a Trigger waiting to be served.
// Both are floored at recheckDelay after the last round.
func (m *Monitor) earlyProbeIn() (time.Duration, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	due := m.asked
	if !due {
		for _, st := range m.states {
			if st.Fails > 0 && st.Fails < downThreshold {
				due = true
				break
			}
		}
	}
	if !due {
		return 0, false
	}
	return max(recheckDelay-m.now().Sub(m.lastTick), 0), true
}

// probeResult is one finished check, carried from the goroutine to the merge below.
type probeResult struct {
	err error
	dur time.Duration
}

func (m *Monitor) tick(ctx context.Context) {
	// Claim any pending Trigger before probing, not after: a request that fails
	// while this round is in flight must schedule another one, since this round
	// may have read the upstream before it broke.
	m.mu.Lock()
	m.asked = false
	m.mu.Unlock()

	results := make([]probeResult, len(m.probes))
	var wg sync.WaitGroup
	for i, p := range m.probes {
		wg.Add(1)
		go func(i int, p Probe) {
			defer wg.Done()
			pctx, cancel := context.WithTimeout(ctx, probeTimeout)
			defer cancel()
			start := time.Now()
			err := p.Check(pctx)
			results[i] = probeResult{err: err, dur: time.Since(start)}
		}(i, p)
	}
	wg.Wait()

	for i, p := range m.probes {
		res := results[i]
		// The gauge records the raw probe outcome, not the debounced one: a
		// dashboard wants to see every failed check, the UI wants a stable answer.
		observability.SetComponentUp(p.Name, p.Kind, p.Mode, res.err == nil, res.dur)
		m.apply(p, res)
	}

	m.mu.Lock()
	m.lastTick = m.now()
	m.mu.Unlock()
}

// apply merges one probe result into the component's state and logs the ok<->down
// edge (steady state stays at debug, so a long outage does not spam a warning per
// tick - same rule as the reconciler poller).
func (m *Monitor) apply(p Probe, res probeResult) {
	m.mu.Lock()
	st := m.states[p.Name]
	wasOK := st.OK
	st.CheckedAt = m.now()
	if res.err != nil {
		st.Fails++
		st.Err = res.err.Error()
		st.OK = st.Fails < downThreshold
	} else {
		st.Fails = 0
		st.Err = ""
		st.OK = true
	}
	if st.OK != wasOK {
		st.Since = st.CheckedAt
	}
	m.states[p.Name] = st
	m.mu.Unlock()

	// The probed component goes under "probe", not "component": the logger is
	// already tagged component=health (the subsystem), and reusing the key would
	// emit a line with it twice.
	switch {
	case wasOK && !st.OK:
		m.log.Warn("component down", "probe", p.Name, "err", st.Err, "duration_ms", res.dur.Milliseconds())
	case !wasOK && st.OK:
		m.log.Info("component recovered", "probe", p.Name, "duration_ms", res.dur.Milliseconds())
	case res.err != nil:
		m.log.Debug("component probe failed", "probe", p.Name, "err", st.Err, "fails", st.Fails)
	default:
		m.log.Debug("component probe ok", "probe", p.Name, "duration_ms", res.dur.Milliseconds())
	}
}
