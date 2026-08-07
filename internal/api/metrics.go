package api

import (
	"context"
	"time"

	"console/internal/observability"
	"console/internal/store"
	"console/pkg/models"
)

// orderStatuses is the full set of order lifecycle states, used to reset drained
// statuses to 0 in the gauge so a state that emptied out stops reporting its
// last count.
var orderStatuses = []models.RequestStatus{
	models.StatusDraft, models.StatusMRCreated, models.StatusMRClosed,
	models.StatusMRMerged, models.StatusDeploying, models.StatusHealthy,
	models.StatusDegraded, models.StatusArgoMissing, models.StatusDeleteRequested,
	models.StatusDeleteMRMerged, models.StatusDeleted,
}

// RunMetricsRefresher periodically refreshes the order gauges until ctx is
// cancelled. It refreshes once immediately, then on each tick. Single-replica
// MVP, so it runs in-process alongside the poller. Component health is not
// refreshed here: the status monitor (internal/status.Monitor) probes the
// components and records their gauges itself.
func (s *Server) RunMetricsRefresher(ctx context.Context, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	s.refreshOrderMetrics(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.refreshOrderMetrics(ctx)
		}
	}
}

// refreshOrderMetrics counts non-deleted-scoped orders by status across all
// teams and updates the per-status gauge.
func (s *Server) refreshOrderMetrics(ctx context.Context) {
	reqs, err := s.Store.ListRequests(ctx, store.RequestFilter{Admin: true, IncludeDeleted: true})
	if err != nil {
		s.Log.Warn("metrics: list requests failed", "err", err)
		return
	}
	counts := make(map[string]int, len(orderStatuses))
	for _, r := range reqs {
		counts[string(r.Status)]++
	}
	known := make([]string, len(orderStatuses))
	for i, st := range orderStatuses {
		known[i] = string(st)
	}
	observability.SetOrderCounts(counts, known)
}
