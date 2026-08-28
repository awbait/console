package observability

import (
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// Prometheus metrics for the portal. All series carry the `console_` prefix and are
// registered on the default registry, which promhttp.Handler() (mounted at
// /metrics) exposes. Collectors are package-level so any layer can update them
// without threading a registry through the call graph.
var (
	// componentUp is 1 when a platform component (upstream or storage backend)
	// answered its probe, 0 otherwise. Mirrors GET /api/v1/status.
	componentUp = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "console_component_up",
		Help: "Platform component health: 1 if the last probe succeeded, 0 otherwise.",
	}, []string{"component", "kind", "mode"})

	// componentProbeDuration tracks how long each component probe takes.
	componentProbeDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "console_component_probe_duration_seconds",
		Help:    "Duration of a platform component health probe.",
		Buckets: prometheus.DefBuckets,
	}, []string{"component"})

	// componentLastProbe is the unix timestamp of the last probe of a component;
	// a stale value flags a stuck refresher.
	componentLastProbe = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "console_component_last_probe_timestamp_seconds",
		Help: "Unix timestamp of the last health probe of a platform component.",
	}, []string{"component"})

	// configChecks is how many configuration checks of a component came back
	// needing attention (see internal/checks). Counts rather than one series per
	// check: which one it is belongs in the log line and on the status page, and
	// this is what an alert would be written against.
	configChecks = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "console_config_checks",
		Help: "Configuration checks of a component currently at this verdict.",
	}, []string{"component", "verdict"})

	// orders is the number of orders in each lifecycle status (DRAFT, HEALTHY,
	// DEGRADED, ...). Refreshed periodically from the store.
	orders = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "console_orders",
		Help: "Number of orders currently in each lifecycle status.",
	}, []string{"status"})

	// users is how many people the portal knows, by state: known (has ever
	// signed in), online, active_24h, active_7d. Numbers only - who they are
	// stays behind the session on the admin activity page, because /metrics is
	// served without authentication and a per-person series would be a staff
	// list that outlives the person by the whole retention window.
	users = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "console_users",
		Help: "People the portal has seen, by state (known, online, active_24h, active_7d).",
	}, []string{"state"})

	// teamUsers is the same count per team: how big a team is and how much of
	// it is around. A team here is a team someone has signed in from.
	teamUsers = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "console_team_users",
		Help: "People of a team the portal has seen, by state (member, online, active_24h).",
	}, []string{"team", "state"})

	// userActions is how much people did in the trailing window, by event type
	// and team. A gauge over a window rather than a counter: the events live in
	// the database, are counted from it on every refresh, and a restart must not
	// look like everyone stopped working.
	userActions = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "console_user_actions",
		Help: "Actions people took in the trailing window, by event type and team.",
	}, []string{"event_type", "team", "window"})

	// The two gauges above carry label sets that come and go (a team nobody is
	// left in, an action nobody has taken today). Remember what was written so
	// the ones that dropped out are deleted rather than frozen at their last
	// reading.
	teamUserSet   = newGaugeSet(teamUsers)
	userActionSet = newGaugeSet(userActions)

	// reconcileRuns counts background reconcile ticks per reconciler and outcome.
	reconcileRuns = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "console_reconcile_runs_total",
		Help: "Total background reconcile ticks, by reconciler and result.",
	}, []string{"reconciler", "result"})

	// reconcileDuration tracks how long a reconciler tick takes.
	reconcileDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "console_reconcile_duration_seconds",
		Help:    "Duration of a single reconciler tick.",
		Buckets: prometheus.DefBuckets,
	}, []string{"reconciler"})

	// reconcileLastSuccess is the unix timestamp of the last successful tick per
	// reconciler; alert when its age exceeds the poll interval.
	reconcileLastSuccess = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "console_reconcile_last_success_timestamp_seconds",
		Help: "Unix timestamp of the last successful reconciler tick.",
	}, []string{"reconciler"})

	// webhooksReceived counts inbound upstream webhooks by source (gitlab|harbor)
	// and result (accepted|ignored|unauthorized|bad_request). Lets us see whether
	// webhooks actually arrive in hybrid mode (vs falling back to the poll).
	webhooksReceived = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "console_webhooks_received_total",
		Help: "Total inbound upstream webhooks, by source and result.",
	}, []string{"source", "result"})

	// argocdSyncs counts admin-triggered ArgoCD syncs (refresh + sync) by result
	// (ok|error). Lets us see whether the manual "deploy from Git" action actually
	// reaches ArgoCD and succeeds.
	argocdSyncs = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "console_argocd_sync_total",
		Help: "Total admin-triggered ArgoCD syncs, by result.",
	}, []string{"result"})

	// mrMergesBlocked counts portal MRs that GitLab says will never merge as they
	// stand, by its reason (conflict, ci_must_pass, not_approved, ...). Counted
	// once per block rather than once per poller tick, so a single sample means a
	// single wedged order waiting for a person.
	mrMergesBlocked = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "console_mr_merge_blocked_total",
		Help: "Total portal merge requests auto-merge gave up on, by GitLab's reason.",
	}, []string{"reason"})

	// mrMergesRetried counts what became of a merge GitLab refused as conflicted,
	// by outcome: reopened - the portal merged the two changes field by field and
	// reopened the change from the current branch; conflict - both changes moved
	// the same field, so a person has to choose. A rising "conflict" is the signal
	// that the retry screen is worth building; a rising "reopened" is orders that
	// used to wedge and no longer do.
	mrMergesRetried = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "console_mr_merge_retried_total",
		Help: "Total conflicted portal merge requests the portal rewrote onto the current branch, by outcome.",
	}, []string{"outcome"})

	// mrMerges counts auto-merge attempts on the portal's own MRs by result
	// (ok|error). A rising error count with no successes means an order is wedged
	// unable to merge (conflict, required pipeline/approvals); the poller would
	// otherwise retry silently every tick with no trace.
	mrMerges = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "console_mr_merge_total",
		Help: "Total portal MR auto-merge attempts, by result.",
	}, []string{"result"})

	// publicationVersionEvents counts per-version publication FSM events by type
	// (submitted|approved|rejected|withdrawn|orderable_on|orderable_off|
	// recommended) - the lifecycle of multi-version service publications.
	publicationVersionEvents = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "console_publication_version_events_total",
		Help: "Total publication version FSM events, by type.",
	}, []string{"event"})

	// busEvents counts events crossing the shared bus between replicas, by
	// direction (out|in) and result (ok|dropped|error). Only the Redis bus
	// reports it: with one replica there is nothing to cross. A rising "dropped"
	// means a browser on another replica was not told about a change it is
	// looking at, which is what an alert would be written against.
	busEvents = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "console_bus_events_total",
		Help: "Total events carried between replicas, by direction and result.",
	}, []string{"direction", "result"})

	// leader is 1 on the replica that runs the background loops and 0 on the
	// others. Summed across replicas it must be 1: a lasting 0 means nothing is
	// reconciling, and a lasting 2 means two replicas are racing each other.
	leader = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "console_leader",
		Help: "1 if this replica currently runs the background loops, 0 otherwise.",
	})
)

// ObserveBusEvent records one event on the shared bus: which way it went and
// what became of it.
func ObserveBusEvent(direction, result string) {
	busEvents.WithLabelValues(direction, result).Inc()
}

// SetLeader records whether this replica currently runs the background loops.
func SetLeader(is bool) {
	v := 0.0
	if is {
		v = 1
	}
	leader.Set(v)
}

// ObservePublicationVersionEvent records one per-version publication FSM event.
func ObservePublicationVersionEvent(event string) {
	publicationVersionEvents.WithLabelValues(event).Inc()
}

// ObserveMRMerge records one auto-merge attempt on a portal MR and its result.
func ObserveMRMerge(err error) {
	result := "ok"
	if err != nil {
		result = "error"
	}
	mrMerges.WithLabelValues(result).Inc()
}

// ObserveMRMergeBlocked records one portal MR that auto-merge stopped retrying,
// with GitLab's reason. Call it once per block, not once per attempt.
func ObserveMRMergeBlocked(reason string) {
	mrMergesBlocked.WithLabelValues(reason).Inc()
}

// ObserveMRMergeRetried records what came of one conflicted merge request:
// "reopened" when the portal merged the changes itself, "conflict" when the two
// disagree on a field and a person has to choose.
func ObserveMRMergeRetried(outcome string) {
	mrMergesRetried.WithLabelValues(outcome).Inc()
}

// ObserveArgoSync records one admin-triggered ArgoCD sync and its result.
func ObserveArgoSync(err error) {
	result := "ok"
	if err != nil {
		result = "error"
	}
	argocdSyncs.WithLabelValues(result).Inc()
}

// ObserveWebhook records one inbound webhook delivery: its source and result.
func ObserveWebhook(source, result string) {
	webhooksReceived.WithLabelValues(source, result).Inc()
}

// SetComponentUp records the health of a platform component (up/down), its probe
// latency and the time of the probe.
func SetComponentUp(name, kind, mode string, up bool, d time.Duration) {
	v := 0.0
	if up {
		v = 1
	}
	componentUp.WithLabelValues(name, kind, mode).Set(v)
	componentProbeDuration.WithLabelValues(name).Observe(d.Seconds())
	componentLastProbe.WithLabelValues(name).Set(float64(time.Now().Unix()))
}

// SetConfigCheckCounts replaces the configuration-check gauge after a round.
// counts is keyed by component then verdict; components and verdicts list every
// value that exists, so one that has just dropped to zero is reset instead of
// keeping its last reading forever.
func SetConfigCheckCounts(counts map[string]map[string]int, components, verdicts []string) {
	for _, c := range components {
		for _, v := range verdicts {
			configChecks.WithLabelValues(c, v).Set(float64(counts[c][v]))
		}
	}
}

// SetOrderCounts replaces the per-status order gauge. Statuses absent from the
// map are reset to 0 so drained states do not linger at their last value; pass
// the full set of known statuses as `known`.
func SetOrderCounts(counts map[string]int, known []string) {
	for _, s := range known {
		orders.WithLabelValues(s).Set(float64(counts[s]))
	}
}

// userStates is every state the people gauge reports, so one that has dropped
// to zero is reset instead of keeping its last reading.
var userStates = []string{"known", "online", "active_24h", "active_7d"}

// SetUserCounts replaces the platform-wide people gauge. States absent from the
// map are set to 0.
func SetUserCounts(counts map[string]int) {
	for _, s := range userStates {
		users.WithLabelValues(s).Set(float64(counts[s]))
	}
}

// SetTeamUserCounts replaces the per-team gauge: counts is keyed by team, then
// by state. A team that is no longer in the map disappears from the gauge.
func SetTeamUserCounts(counts map[string]map[string]int) {
	round := map[string]float64{}
	labels := map[string][]string{}
	for team, byState := range counts {
		for state, n := range byState {
			key := team + "\x00" + state
			round[key] = float64(n)
			labels[key] = []string{team, state}
		}
	}
	teamUserSet.replace(round, labels)
}

// ActionCount is one bar of the actions gauge: how many events of one type one
// team produced inside the window.
type ActionCount struct {
	EventType string
	Team      string
	Count     int
}

// SetUserActionCounts replaces the actions gauge for one window (e.g. "24h").
// Combinations that have fallen out of it are dropped.
func SetUserActionCounts(window string, counts []ActionCount) {
	round := map[string]float64{}
	labels := map[string][]string{}
	for _, c := range counts {
		key := c.EventType + "\x00" + c.Team + "\x00" + window
		round[key] = float64(c.Count)
		labels[key] = []string{c.EventType, c.Team, window}
	}
	userActionSet.replace(round, labels)
}

// gaugeSet is a GaugeVec whose label sets are not known in advance and change
// between rounds. It writes the round it is given and deletes whatever it wrote
// last time and has not written now, so a series that stopped existing stops
// reporting instead of freezing at its final value.
type gaugeSet struct {
	mu   sync.Mutex
	vec  *prometheus.GaugeVec
	live map[string][]string // key -> the label values that produced it
}

func newGaugeSet(vec *prometheus.GaugeVec) *gaugeSet {
	return &gaugeSet{vec: vec, live: map[string][]string{}}
}

func (g *gaugeSet) replace(round map[string]float64, labels map[string][]string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	for key, v := range round {
		g.vec.WithLabelValues(labels[key]...).Set(v)
	}
	for key, lv := range g.live {
		if _, still := round[key]; !still {
			g.vec.DeleteLabelValues(lv...)
		}
	}
	g.live = labels
}

// ObserveReconcile records one reconciler tick: its duration, the run counter
// (result=ok|error) and, on success, the last-success timestamp.
func ObserveReconcile(name string, d time.Duration, err error) {
	reconcileDuration.WithLabelValues(name).Observe(d.Seconds())
	result := "ok"
	if err != nil {
		result = "error"
	}
	reconcileRuns.WithLabelValues(name, result).Inc()
	if err == nil {
		reconcileLastSuccess.WithLabelValues(name).Set(float64(time.Now().Unix()))
	}
}
