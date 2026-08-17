package observability

import (
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

	// orders is the number of orders in each lifecycle status (DRAFT, HEALTHY,
	// DEGRADED, ...). Refreshed periodically from the store.
	orders = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "console_orders",
		Help: "Number of orders currently in each lifecycle status.",
	}, []string{"status"})

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
)

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

// SetOrderCounts replaces the per-status order gauge. Statuses absent from the
// map are reset to 0 so drained states do not linger at their last value; pass
// the full set of known statuses as `known`.
func SetOrderCounts(counts map[string]int, known []string) {
	for _, s := range known {
		orders.WithLabelValues(s).Set(float64(counts[s]))
	}
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
