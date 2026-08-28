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
// cancelled. It refreshes once immediately, then on each tick. Component health
// is not refreshed here: the status monitor (internal/status.Monitor) probes the
// components and records their gauges itself.
//
// It runs alongside the poller, on the replica that holds the background loops
// (see Server.Leader), and for the same reason: these gauges count the same rows
// of the same database on every replica. A standby publishes no order series at
// all, so adding the replicas up in a query counts every order once rather than
// once per replica.
func (s *Server) RunMetricsRefresher(ctx context.Context, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	if s.leading() {
		s.RefreshMetrics(ctx)
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if s.leading() {
				s.RefreshMetrics(ctx)
			}
		}
	}
}

// RefreshMetrics recomputes every gauge the portal derives from stored state,
// once. The loop above is the only caller in production; it is exported so a
// test can take one reading without starting a ticker.
func (s *Server) RefreshMetrics(ctx context.Context) {
	s.refreshOrderMetrics(ctx)
	s.refreshActivityMetrics(ctx)
}

// actionWindow is how far back the actions gauge looks. A day: long enough that
// a quiet morning does not read as a dead platform, short enough that the
// number still means "lately".
const actionWindow = 24 * time.Hour

// refreshActivityMetrics counts the people using the portal and what they have
// been doing. It also prunes presence: this loop is the only thing that runs on
// its own, and the presence set is the only thing here that would otherwise
// grow without bound.
//
// Names never reach the gauges - see internal/api/handlers_activity.go for why.
func (s *Server) refreshActivityMetrics(ctx context.Context) {
	if s.Activity == nil {
		return
	}
	if err := s.Activity.Prune(ctx); err != nil {
		s.logger().Warn("metrics: prune presence failed", "err", err)
	}
	ov, err := s.Activity.Overview(ctx)
	if err != nil {
		s.logger().Warn("metrics: activity overview failed", "err", err)
		return
	}
	observability.SetUserCounts(map[string]int{
		"known":      ov.Totals.Users,
		"online":     ov.Totals.Online,
		"active_24h": ov.Totals.Active24h,
		"active_7d":  ov.Totals.Active7d,
	})
	teams := make(map[string]map[string]int, len(ov.Teams))
	for _, t := range ov.Teams {
		teams[t.Team] = map[string]int{
			"member": t.Members, "online": t.Online, "active_24h": t.Active24h,
		}
	}
	observability.SetTeamUserCounts(teams)

	counts, err := s.Store.CountActivity(ctx, time.Now().Add(-actionWindow))
	if err != nil {
		s.logger().Warn("metrics: count activity failed", "err", err)
		return
	}
	actions := make([]observability.ActionCount, 0, len(counts))
	for _, c := range counts {
		actions = append(actions, observability.ActionCount{
			EventType: c.EventType, Team: c.Team, Count: c.Count,
		})
	}
	observability.SetUserActionCounts("24h", actions)
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
