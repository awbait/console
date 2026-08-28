// Package status answers "is the platform working": it runs the background
// poller that advances order states, probes the upstreams the portal depends on,
// and maps their health onto the capabilities a person can still use.
package status

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"console/internal/observability"
)

// Reconciler advances state on each tick. Both the fake ArgoCD (materialise
// apps from git) and the provisioning service implement it.
type Reconciler interface {
	Reconcile(ctx context.Context) error
}

// named tags a Reconciler with a stable label for metrics and logging.
type named struct {
	Reconciler
	name string
}

// Named wraps a reconciler so the poller can label its metrics. Unwrapped
// reconcilers report under "unknown".
func Named(name string, r Reconciler) Reconciler { return named{Reconciler: r, name: name} }

// nameOf returns the metrics label for a reconciler.
func nameOf(r Reconciler) string {
	if n, ok := r.(named); ok {
		return n.name
	}
	return "unknown"
}

// reconcileTimeout is a per-reconciler safety net so a wedged DB query or
// upstream call (background paths carry no request deadline) cannot tie up a
// connection forever and block every later reconciler. Generous: normal ticks
// finish in milliseconds to seconds.
const reconcileTimeout = 5 * time.Minute

// backoffMax caps the exponential backoff applied to a failing reconciler, so a
// persistently-broken upstream (e.g. GitLab discovery scanning every project) is
// not hammered every tick.
const backoffMax = 5 * time.Minute

// backoffFor returns how long to skip a reconciler after `failures` consecutive
// failures: interval * 2^(failures-1), capped at backoffMax. Zero means "run now".
func backoffFor(interval time.Duration, failures int) time.Duration {
	if failures <= 0 {
		return 0
	}
	d := interval << (failures - 1) // interval * 2^(failures-1)
	if d <= 0 || d > backoffMax {   // overflow or over cap
		return backoffMax
	}
	return d
}

// Poller runs the reconcilers on an interval, on one replica at a time. Which
// one is not its business: it asks before every sweep (see SetLeader), and a
// replica that is not leading does nothing at all - not even the sweep a
// webhook asked for, because the leader was told about that webhook too and is
// the one holding the orders it would advance.
type Poller struct {
	interval    time.Duration
	reconcilers []Reconciler
	log         *slog.Logger
	// leads reports whether this replica may reconcile. Nil means it always
	// may, which is what a single-replica portal and every test want. Wired
	// once at startup, before Run.
	leads func() bool
	// mu guards the per-reconciler state maps below: tick() writes them from the
	// Run goroutine, Snapshot() reads them from an HTTP handler goroutine.
	mu sync.Mutex
	// failing tracks which reconcilers were failing on the previous tick, keyed
	// by name, so we log on the ok<->fail edge instead of every tick.
	failing map[string]bool
	// fails counts consecutive failures per reconciler; nextAttempt is the time
	// before which a failing reconciler is skipped (exponential backoff).
	fails       map[string]int
	nextAttempt map[string]time.Time
	// lastSuccess/lastErr/lastDuration record the most recent outcome per
	// reconciler for the status page (Snapshot).
	lastSuccess  map[string]time.Time
	lastErr      map[string]string
	lastDuration map[string]time.Duration
	// trigger requests an out-of-band sweep now (e.g. an inbound webhook) instead
	// of waiting for the next tick. Buffered to 1: concurrent triggers coalesce
	// into a single pending sweep, so a burst of webhooks cannot stampede the
	// reconcilers.
	trigger chan string
	// now is the clock, injectable in tests; defaults to time.Now.
	now func() time.Time
}

// NewPoller builds a poller. Reconcilers run in order each tick.
func NewPoller(interval time.Duration, log *slog.Logger, reconcilers ...Reconciler) *Poller {
	return &Poller{
		interval: interval, reconcilers: reconcilers, log: log,
		failing: map[string]bool{}, fails: map[string]int{}, nextAttempt: map[string]time.Time{},
		lastSuccess: map[string]time.Time{}, lastErr: map[string]string{}, lastDuration: map[string]time.Duration{},
		trigger: make(chan string, 1),
		now:     time.Now,
	}
}

// SetLeader wires the question "may this replica reconcile". Call it before
// Run; leaving it unset means yes, always.
func (p *Poller) SetLeader(leads func() bool) { p.leads = leads }

// leading reports whether this replica may reconcile right now.
func (p *Poller) leading() bool { return p.leads == nil || p.leads() }

// ReconcilerState is a point-in-time view of one reconciler's health, for the
// status page. LastSuccess is zero if it has never succeeded.
type ReconcilerState struct {
	Name        string
	Failing     bool
	Fails       int
	LastSuccess time.Time
	LastErr     string
	LastRunMs   int64
}

// Snapshot returns the current health of every reconciler, in run order. Safe to
// call concurrently with the poller loop.
//
// On a replica that is not leading it returns nothing at all, rather than a list
// of loops that have never run: they are running, on the replica that holds
// them, and a row saying otherwise would be read as a broken portal.
func (p *Poller) Snapshot() []ReconcilerState {
	if !p.leading() {
		return nil
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]ReconcilerState, 0, len(p.reconcilers))
	for _, r := range p.reconcilers {
		name := nameOf(r)
		out = append(out, ReconcilerState{
			Name:        name,
			Failing:     p.failing[name],
			Fails:       p.fails[name],
			LastSuccess: p.lastSuccess[name],
			LastErr:     p.lastErr[name],
			LastRunMs:   p.lastDuration[name].Milliseconds(),
		})
	}
	return out
}

// Trigger requests an immediate reconcile sweep instead of waiting for the next
// tick, for the hybrid status mode where inbound webhooks (GitLab MR merged,
// Harbor chart pushed) accelerate the otherwise periodic poll. Non-blocking and
// safe to call concurrently: if a sweep is already pending, the trigger is
// coalesced (the buffered channel holds at most one). reason is logged for
// observability. A nil poller is a no-op so callers need not guard.
func (p *Poller) Trigger(reason string) {
	if p == nil {
		return
	}
	select {
	case p.trigger <- reason:
	default: // a sweep is already queued; coalesce
	}
}

// Run blocks, ticking until the context is cancelled. It always reconciles once
// immediately on start (to catch up after downtime). With a positive interval it
// then ticks periodically; with interval <= 0 (webhook-only mode) it does not
// tick on its own and advances state only when Trigger fires.
func (p *Poller) Run(ctx context.Context) {
	// A nil channel blocks forever in select, so interval <= 0 cleanly disables
	// periodic ticking without a separate code path.
	var tick <-chan time.Time
	if p.interval > 0 {
		t := time.NewTicker(p.interval)
		defer t.Stop()
		tick = t.C
	}
	p.tick(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick:
			p.tick(ctx)
		case reason := <-p.trigger:
			p.log.Debug("reconcile triggered", "reason", reason)
			p.tick(ctx)
		}
	}
}

func (p *Poller) tick(ctx context.Context) {
	if !p.leading() {
		// Another replica holds the work. Nothing is recorded either: the status
		// page of a standby replica has no reconcilers to report, which is the
		// truth about it (see Snapshot).
		return
	}
	for _, r := range p.reconcilers {
		name := nameOf(r)
		// Skip reconcilers in backoff after consecutive failures, so a broken
		// upstream is retried with exponential delay instead of every tick.
		p.mu.Lock()
		next, inBackoff := p.nextAttempt[name]
		p.mu.Unlock()
		if inBackoff && p.now().Before(next) {
			continue
		}
		start := time.Now()
		rctx, cancel := context.WithTimeout(ctx, reconcileTimeout)
		err := r.Reconcile(rctx)
		cancel()
		dur := time.Since(start)
		observability.ObserveReconcile(name, dur, err)

		p.mu.Lock()
		p.lastDuration[name] = dur
		wasFailing := p.failing[name]
		if err != nil {
			p.fails[name]++
			p.nextAttempt[name] = p.now().Add(backoffFor(p.interval, p.fails[name]))
			p.lastErr[name] = err.Error()
			p.failing[name] = true
		} else {
			delete(p.fails, name)
			delete(p.nextAttempt, name)
			p.lastErr[name] = ""
			p.lastSuccess[name] = p.now()
			p.failing[name] = false
		}
		fails := p.fails[name]
		p.mu.Unlock()

		// Log on the ok<->fail edge only: a flapping upstream (e.g. GitLab still
		// booting) would otherwise spam one WARN per tick. Steady-state lines stay
		// at debug. Metrics above still record every tick for rate/alerting.
		switch {
		case err != nil && !wasFailing:
			p.log.Warn("reconcile failing", "reconciler", name, "err", err)
		case err != nil:
			p.log.Debug("reconcile still failing", "reconciler", name, "err", err, "backoff_ms", backoffFor(p.interval, fails).Milliseconds())
		case wasFailing:
			p.log.Info("reconcile recovered", "reconciler", name, "duration_ms", dur.Milliseconds())
		default:
			p.log.Debug("reconcile ok", "reconciler", name, "duration_ms", dur.Milliseconds())
		}
	}
}
