// Package checks answers the question the health probes cannot: an upstream
// answers, but is the portal actually wired to it?
//
// A probe (internal/status) says "GitLab is up". That is not the same as "the
// token may create merge requests", "the webhook is registered", "the secrets on
// both sides match" or "the Argo CD project this portal commits into exists".
// Every one of those is normally discovered by the first real order, which means
// discovered by a user. These checks discover them on the status page instead.
//
// Rules the whole package follows:
//   - Nothing is created or changed upstream. Every call is a read.
//   - No secret ever reaches a result: facts are names, counts and verdicts.
//   - An upstream that does not answer yields VerdictUnknown, never VerdictFail.
//     "Harbor is down" is already said by the probes; six red boxes repeating it
//     would only bury the checks that mean something.
//   - Only identifiers live here. The sentences a person reads are product copy
//     and live on the front end (web/src/app/configChecks.ts), exactly as they
//     do for capabilities.
package checks

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"console/internal/config"
	"console/internal/observability"
)

// Verdict is what one check concluded.
type Verdict string

const (
	// VerdictOK - configured and working as far as a read-only look can tell.
	VerdictOK Verdict = "ok"
	// VerdictWarn - works, but something here will bite later (a token about to
	// expire, a hook covering only part of the group, auto-merge left on).
	VerdictWarn Verdict = "warn"
	// VerdictFail - this is broken and somebody's order will hit it.
	VerdictFail Verdict = "fail"
	// VerdictSkip - deliberately not configured, so there is nothing to judge.
	VerdictSkip Verdict = "skip"
	// VerdictUnknown - we could not look: the upstream did not answer, or it
	// does not expose what the check needed.
	VerdictUnknown Verdict = "unknown"
	// VerdictSilent - there is nothing to judge yet, and saying so is noise.
	// The check is dropped from the snapshot entirely rather than shown as a
	// grey row nobody can act on.
	//
	// This is the difference between a setup assistant and a status report, and
	// it is the rule Argo CD follows: it does not probe a cluster until an
	// application targets it, and a cluster nobody deploys to is left alone
	// rather than reported as broken or as pending. A configuration that is not
	// in use yet cannot be wrong yet.
	VerdictSilent Verdict = "silent"
)

// Components a check can belong to. They match the probe names in
// internal/status, so a check can be muted when its component is down.
const (
	ComponentPortal   = "portal" // static checks: configuration read against itself
	ComponentGitLab   = "gitlab"
	ComponentHarbor   = "harbor"
	ComponentArgoCD   = "argocd"
	ComponentKeycloak = "keycloak"
)

// Reasons shared by more than one check. Check-specific ones are declared next
// to the check that returns them; all of them are turned into sentences by
// web/src/app/configChecks.ts.
const (
	ReasonUpstreamDown  = "upstream_down"  // the component did not answer, so we did not look
	ReasonNotConfigured = "not_configured" // nothing is set, on purpose
	ReasonForbidden     = "forbidden"      // the upstream refused to tell us
	ReasonUnavailable   = "unavailable"    // the upstream has no such endpoint (older version, other edition)
)

// Result is the outcome of one check.
//
// Reason names why the verdict is what it is, Facts carries the data behind it
// (names, counts, dates - never a credential). Both are identifiers and numbers:
// the front end owns the wording.
type Result struct {
	Verdict Verdict           `json:"verdict"`
	Reason  string            `json:"reason,omitempty"`
	Facts   map[string]string `json:"facts,omitempty"`
}

// Check is one named configuration check.
//
// One check per configured thing, not one per question asked about it. The
// verdict is read next to the setting it is about (the admin configuration
// page), the way a connection status is read next to a repository in Argo CD's
// settings, so a setting with three things possibly wrong with it still gets one
// answer and one place to fix it.
type Check struct {
	// ID is stable and mirrored in web/src/app/configChecks.ts.
	ID string
	// Component is the upstream this check is about. When that component is
	// down the check is not run at all and reports VerdictUnknown.
	Component string
	// Vars are the environment variables that decide this check, so the page can
	// point at what to edit. Shown as names only.
	//
	// The first one is the anchor: the setting the verdict is displayed next to.
	// The rest are named in the wording as the other half of the same knob. Two
	// checks must never share an anchor, or one of them has nowhere to appear
	// (TestEveryCheckHasItsOwnAnchor).
	Vars []string
	// Run performs the check. It must not write anything upstream.
	Run func(ctx context.Context) Result
}

// CheckResult is one finished check, as served to the status page.
type CheckResult struct {
	ID        string            `json:"id"`
	Component string            `json:"component"`
	Verdict   Verdict           `json:"verdict"`
	Reason    string            `json:"reason,omitempty"`
	Facts     map[string]string `json:"facts,omitempty"`
	Vars      []string          `json:"vars,omitempty"`
	// DurationMs is how long the check took, for the admin who wants to know
	// which one is making the page slow to refresh.
	DurationMs int64 `json:"duration_ms,omitempty"`
}

// Snapshot is the whole check set as of the last run.
type Snapshot struct {
	Results []CheckResult `json:"results"`
	// CheckedAt is when the last round finished; zero before the first one.
	CheckedAt time.Time `json:"checked_at,omitzero"`
	// Running reports that a round is in flight, so the page can say so instead
	// of showing the previous answer as if it were fresh.
	Running bool `json:"running"`
}

// ok reports a passing check with optional facts.
func ok(facts map[string]string) Result { return Result{Verdict: VerdictOK, Facts: facts} }

// silent reports that there is nothing to judge yet, so the check does not
// appear at all. reason is carried for the log, never for the screen.
func silent(reason string) Result { return Result{Verdict: VerdictSilent, Reason: reason} }

// verdict builds a result with a reason.
func verdict(v Verdict, reason string, facts map[string]string) Result {
	return Result{Verdict: v, Reason: reason, Facts: facts}
}

// facts is shorthand for a fact map built from alternating key/value pairs. An
// odd trailing key is dropped rather than paired with nothing.
func factsOf(kv ...string) map[string]string {
	m := make(map[string]string, len(kv)/2)
	for i := 0; i+1 < len(kv); i += 2 {
		m[kv[i]] = kv[i+1]
	}
	return m
}

// All is the whole check set, in the order the configuration page reads. One
// place so the set cannot differ between the portal and the tests that hold it
// to its rules (see TestEveryCheckHasItsOwnAnchor). Any dependency may be nil:
// the checks behind it then report unknown instead of panicking.
func All(
	cfg *config.Config,
	gitlabAPI GitLabAPI,
	hooks HookScoper,
	harborAPI HarborAPI,
	argoAPI ArgoCDAPI,
	signIns SignInSource,
	deliveries Deliveries,
) []Check {
	set := Static(cfg)
	set = append(set, GitLabChecks(cfg, gitlabAPI, hooks, deliveries)...)
	set = append(set, HarborChecks(cfg, harborAPI, deliveries)...)
	set = append(set, ArgoCDChecks(cfg, argoAPI)...)
	return append(set, KeycloakChecks(cfg, signIns)...)
}

// runTimeout bounds one check. Generous next to the 5s health probe: some checks
// make several calls (the per-repository webhook sweep makes one per repo), and
// a slow answer is still an answer.
const runTimeout = 30 * time.Second

// Interval is how often the whole set runs by itself. Far rarer than the health
// probes: configuration changes when somebody deploys, not between two page
// refreshes, and every round costs the upstreams a handful of API calls. An
// admin who has just changed something does not wait for it - the status page
// has a button that runs the set now.
const Interval = 10 * time.Minute

// Announcer is told what a finished round concluded, so that the part of it
// nobody would otherwise see can be sent to the people who can fix it. Optional:
// without one the results only ever appear on the configuration page.
//
// It is called with every result, not only the bad ones: a check that has gone
// back to normal is what an announcement of the opposite has to be called off
// by.
type Announcer interface {
	Round(ctx context.Context, results []CheckResult)
}

// Runner keeps the check set and the last result of every check. Like the health
// monitor it is the single place the upstreams are read from, so the number of
// admins looking at the status page does not change the load on GitLab.
type Runner struct {
	checks   []Check
	log      *slog.Logger
	announce Announcer
	// healthy reports whether a component answered its last probe. Optional: a
	// nil func treats everything as up, which is what tests want.
	healthy func(component string) bool

	mu        sync.Mutex
	results   map[string]CheckResult
	checkedAt time.Time
	running   bool
	// trigger carries an out-of-band request to run the set now (the "check
	// again" button). Buffered to one: concurrent clicks coalesce.
	trigger chan struct{}

	now func() time.Time // clock, injectable in tests
}

// NewRunner builds a runner over the given checks. Until the first round every
// check reports unknown: the portal must not claim a configuration is fine, nor
// that it is broken, before it has looked.
func NewRunner(log *slog.Logger, healthy func(string) bool, checks ...Check) *Runner {
	r := &Runner{
		checks:  checks,
		log:     log,
		healthy: healthy,
		results: make(map[string]CheckResult, len(checks)),
		trigger: make(chan struct{}, 1),
		now:     time.Now,
	}
	for _, c := range checks {
		r.results[c.ID] = CheckResult{ID: c.ID, Component: c.Component, Vars: c.Vars, Verdict: VerdictUnknown}
	}
	return r
}

// SetAnnouncer wires who hears about a finished round. Set before Run: it is
// read on every round and written once, at startup.
func (r *Runner) SetAnnouncer(a Announcer) {
	if r != nil {
		r.announce = a
	}
}

// Snapshot returns the last result of every check that has something to say, in
// declaration order. A check that came back silent is left out: it is not a
// grey row, it is not a row.
func (r *Runner) Snapshot() Snapshot {
	if r == nil {
		return Snapshot{}
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]CheckResult, 0, len(r.checks))
	for _, c := range r.checks {
		if res := r.results[c.ID]; res.Verdict != VerdictSilent {
			out = append(out, res)
		}
	}
	return Snapshot{Results: out, CheckedAt: r.checkedAt, Running: r.running}
}

// Trigger asks for a round now instead of at the next interval, for the "check
// again" button. Non-blocking; concurrent requests coalesce into one round. A
// nil runner is a no-op.
func (r *Runner) Trigger(reason string) {
	if r == nil {
		return
	}
	select {
	case r.trigger <- struct{}{}:
		r.logger().Debug("configuration checks requested", "reason", reason)
	default: // a round is already queued
	}
}

// Run blocks, running the set once immediately and then every Interval, until
// the context is cancelled. Single-replica MVP, so it runs in-process next to
// the poller and the health monitor.
func (r *Runner) Run(ctx context.Context) {
	t := time.NewTicker(Interval)
	defer t.Stop()
	r.round(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			r.round(ctx)
		case <-r.trigger:
			r.round(ctx)
		}
	}
}

// round runs every check concurrently and replaces the snapshot.
func (r *Runner) round(ctx context.Context) {
	r.mu.Lock()
	if r.running { // a manual trigger landed on top of a round already in flight
		r.mu.Unlock()
		return
	}
	r.running = true
	r.mu.Unlock()

	results := make([]CheckResult, len(r.checks))
	var wg sync.WaitGroup
	for i, c := range r.checks {
		wg.Add(1)
		go func(i int, c Check) {
			defer wg.Done()
			results[i] = r.one(ctx, c)
		}(i, c)
	}
	wg.Wait()

	r.mu.Lock()
	for _, res := range results {
		r.results[res.ID] = res
	}
	r.checkedAt = r.now()
	r.running = false
	r.mu.Unlock()

	r.publish(results)
	if r.announce != nil {
		r.announce.Round(ctx, results)
	}
	r.logger().Debug("configuration checks done", "checks", len(results), "problems", countProblems(results))
}

// allComponents and allVerdicts are the full label sets of the gauge, so a
// verdict that has just stopped happening is reset to zero rather than left at
// its last reading.
var (
	allComponents = []string{ComponentPortal, ComponentGitLab, ComponentHarbor, ComponentArgoCD, ComponentKeycloak}
	allVerdicts   = []string{
		string(VerdictOK), string(VerdictWarn), string(VerdictFail),
		string(VerdictSkip), string(VerdictUnknown), string(VerdictSilent),
	}
)

// publish records the round on the Prometheus gauge.
func (r *Runner) publish(results []CheckResult) {
	counts := make(map[string]map[string]int, len(allComponents))
	for _, res := range results {
		byVerdict := counts[res.Component]
		if byVerdict == nil {
			byVerdict = map[string]int{}
			counts[res.Component] = byVerdict
		}
		byVerdict[string(res.Verdict)]++
	}
	observability.SetConfigCheckCounts(counts, allComponents, allVerdicts)
}

// one runs a single check, or reports unknown without touching the network when
// its component is down.
func (r *Runner) one(ctx context.Context, c Check) CheckResult {
	out := CheckResult{ID: c.ID, Component: c.Component, Vars: c.Vars}
	if c.Component != ComponentPortal && r.healthy != nil && !r.healthy(c.Component) {
		out.Verdict, out.Reason = VerdictUnknown, ReasonUpstreamDown
		return out
	}
	cctx, cancel := context.WithTimeout(ctx, runTimeout)
	defer cancel()
	start := time.Now()
	res := c.Run(cctx)
	out.DurationMs = time.Since(start).Milliseconds()
	out.Verdict, out.Reason, out.Facts = res.Verdict, res.Reason, res.Facts
	if out.Verdict == VerdictFail {
		// One line per failing check per round, at 10-minute intervals: rare
		// enough to keep, and it is the only trace left if nobody opens the page.
		r.logger().Warn("configuration check failed", "check", c.ID, "component", c.Component, "reason", out.Reason)
	}
	return out
}

// countProblems counts the results that need somebody to do something.
func countProblems(results []CheckResult) int {
	n := 0
	for _, res := range results {
		if res.Verdict == VerdictFail || res.Verdict == VerdictWarn {
			n++
		}
	}
	return n
}

func (r *Runner) logger() *slog.Logger {
	if r.log != nil {
		return r.log
	}
	return slog.Default()
}
