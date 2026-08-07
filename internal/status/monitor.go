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

	// mu guards states: the tick writes it from the Run goroutine, Snapshot
	// reads it from HTTP handler goroutines.
	mu     sync.Mutex
	states map[string]ComponentState

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

// Run blocks, probing once immediately and then on every tick, until the context
// is cancelled. Single-replica MVP, so it runs in-process like the poller.
func (m *Monitor) Run(ctx context.Context) {
	t := time.NewTicker(m.interval)
	defer t.Stop()
	m.tick(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			m.tick(ctx)
		}
	}
}

// probeResult is one finished check, carried from the goroutine to the merge below.
type probeResult struct {
	err error
	dur time.Duration
}

func (m *Monitor) tick(ctx context.Context) {
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
