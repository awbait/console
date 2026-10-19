package provisioning

import (
	"context"
	"time"

	"console/internal/observability"
	"console/pkg/models"
)

// A deleted order stays in the portal: its history is the audit trail, and its
// row is what restoring it reads from (see Copy). DELETED_ORDERS_RETENTION puts
// an end to that. Past it the order goes for good, with its merge requests and
// its history, and can no longer be restored. Discarded drafts go the same way:
// they are deleted orders too.

// purgeBatch bounds one statement, and purgeRounds one sweep: a backlog that
// built up while the retention was off is worked off over a few ticks, not in
// one transaction that holds every row of it.
const (
	purgeBatch  = 500
	purgeRounds = 10
)

// purgeEvery is how often the sweep looks. It runs on the poller's tick, every
// few seconds, and a retention is counted in days.
const purgeEvery = time.Hour

// PurgeDeleted removes the orders deleted longer ago than the retention, at
// most once per purgeEvery. A retention of zero keeps them forever and does
// nothing. The clock is the process's own: a new leader looks once more at
// once, which costs one query.
func (s *Service) PurgeDeleted(ctx context.Context, retention time.Duration) error {
	if retention <= 0 {
		return nil
	}
	s.purgeMu.Lock()
	due := time.Since(s.purgedAt) >= purgeEvery
	if due {
		s.purgedAt = time.Now()
	}
	s.purgeMu.Unlock()
	if !due {
		return nil
	}
	cutoff := time.Now().Add(-retention)
	total := 0
	for range purgeRounds {
		n, err := s.store.PurgeDeletedRequests(ctx, cutoff, purgeBatch)
		if err != nil {
			return err
		}
		total += n
		observability.ObserveOrdersPurged(n)
		if n < purgeBatch {
			break
		}
	}
	if total > 0 {
		s.logger().Info("deleted orders purged", "count", total, "retention", retention.String())
	}
	return nil
}

// PurgeAt is when a deleted order is removed for good under the retention, nil
// for an order that is not deleted or a retention that keeps everything.
func PurgeAt(r *models.Request, retention time.Duration) *time.Time {
	if retention <= 0 || r.DeletedAt == nil || r.Status != models.StatusDeleted {
		return nil
	}
	at := r.DeletedAt.Add(retention)
	return &at
}
