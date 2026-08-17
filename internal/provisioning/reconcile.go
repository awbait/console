package provisioning

import (
	"context"
	"errors"
	"time"

	"console/internal/argocd"
	"console/internal/gitlab"
	"console/internal/observability"
	"console/pkg/models"
)

// Reconcile advances every active order based on its MR and ArgoCD state.
// It is mode-agnostic (works against real or fake upstreams) and idempotent,
// so the single-replica poller can call it on every tick.
func (s *Service) Reconcile(ctx context.Context) error {
	active, err := s.store.ListActive(ctx)
	if err != nil {
		return err
	}
	s.logger().Debug("reconcile sweep", "active", len(active))
	for _, r := range active {
		s.reconcileOne(ctx, r)
	}
	return nil
}

func (s *Service) reconcileOne(ctx context.Context, r *models.Request) {
	// 1) advance MR state from the latest MR (works even if it merged instantly)
	if mrs, err := s.store.ListMRs(ctx, r.ID); err == nil && len(mrs) > 0 {
		latest := mrs[len(mrs)-1]
		// Read the live MR before touching it: its state drives the transition
		// below, and the mergeability it reports is what tells auto-merge whether
		// merging is worth attempting at all.
		if live, gerr := s.gl.GetMR(ctx, latest.GitLabProjectID, latest.MRIID); gerr == nil {
			if live.State != latest.Status {
				latest.Status = live.State
				if uerr := s.store.UpdateMR(ctx, latest); uerr != nil {
					s.logger().Warn("mr state persist failed",
						"order_id", r.ID, "mr_iid", latest.MRIID, "err", uerr)
				}
			}
			// Optional auto-merge: merge the open MR ourselves (no human gate).
			if s.autoMerge && latest.Status == models.MROpened &&
				(r.Status == models.StatusMRCreated || r.Status == models.StatusDeleteRequested) {
				// A change rewritten onto a moved branch leaves this record pointing
				// at the merge request it replaced, now closed. Reading the order's
				// state off it would call the order abandoned; it has a new change
				// open instead, which the next tick picks up.
				if s.autoMergeMR(ctx, r, latest, live.DetailedMergeStatus) {
					return
				}
			}
		} else {
			// Without the live MR state the order cannot observe a merge/close and
			// is stuck at MR_CREATED. Surface it instead of stalling silently.
			s.logger().Warn("mr state fetch failed",
				"order_id", r.ID, "mr_iid", latest.MRIID, "err", gerr)
		}
		switch r.Status {
		case models.StatusMRCreated:
			switch latest.Status {
			case models.MRMerged:
				s.tryTransition(ctx, r, models.StatusMRMerged)
			case models.MRClosed:
				s.tryTransition(ctx, r, models.StatusMRClosed)
			}
		case models.StatusDeleteRequested:
			switch latest.Status {
			case models.MRMerged:
				s.tryTransition(ctx, r, models.StatusDeleteMRMerged)
			case models.MRClosed:
				s.tryTransition(ctx, r, models.StatusMRClosed)
			}
		}
	}

	// 2) reconcile against ArgoCD
	switch r.Status {
	case models.StatusMRMerged:
		if _, err := s.argo.GetApplication(ctx, r.ArgoCDAppName); err == nil {
			s.tryTransition(ctx, r, models.StatusDeploying)
			// Nudge ArgoCD to pull and apply the just-merged revision now instead
			// of waiting for its own git poll; reconcile then gates Healthy on it.
			_ = s.argo.Sync(ctx, r.ArgoCDAppName)
		}
	case models.StatusDeploying:
		// Freshly merged: wait until ArgoCD has actually finished syncing before
		// calling it Healthy, so we don't latch onto a stale pre-sync report.
		if app, err := s.argo.GetApplication(ctx, r.ArgoCDAppName); err == nil {
			if target := mapHealth(app.Health); target != "" &&
				(target != models.StatusHealthy || deploySettled(app)) {
				s.tryTransition(ctx, r, target)
			}
		}
	case models.StatusHealthy, models.StatusDegraded:
		// Already deployed: follow ArgoCD's reported health directly. Do NOT gate on
		// sync status here. Instances of the same chart share one Git branch, so a
		// sibling's create/update/delete MR advances the branch and briefly marks
		// this (unchanged) app OutOfSync; that must not demote a Healthy product
		// back to DEPLOYING - its own manifests/values did not change.
		if app, err := s.argo.GetApplication(ctx, r.ArgoCDAppName); err == nil {
			if target := mapHealth(app.Health); target != "" {
				s.tryTransition(ctx, r, target)
			}
		}
	case models.StatusDeleteMRMerged:
		if _, err := s.argo.GetApplication(ctx, r.ArgoCDAppName); errors.Is(err, models.ErrNotFound) {
			s.markDeleted(ctx, r)
		}
	}
}

// autoMergeMR merges one open portal MR when GitLab says it will accept it.
// The poller calls this for every open MR on every tick, so it has to stay
// quiet while GitLab is still deciding and speak up exactly once when the MR
// will never merge on its own. detailed is GitLab's detailed_merge_status.
// Reports whether the merge request it was given has been superseded by a
// rewritten one, in which case the caller is holding a stale record.
func (s *Service) autoMergeMR(ctx context.Context, r *models.Request, mr *models.RequestMR, detailed string) (superseded bool) {
	switch gitlab.ClassifyMerge(detailed) {
	case gitlab.MergePending:
		// Mergeability is computed asynchronously. A just-opened MR, or one whose
		// target branch a sibling order has just advanced, reads as pending for a
		// tick or two and then merges by itself - nothing to report.
		s.logger().Debug("mr merge pending",
			"order_id", r.ID, "mr_iid", mr.MRIID, "reason", detailed)
		return false
	case gitlab.MergeBlocked:
		// A conflict is the one blocked state the portal can clear by itself: the
		// change is still good, it was written against a branch that has since
		// moved. Rewrite it on top of the branch as it is now; only a field both
		// changes moved needs a person.
		if detailed == "conflict" {
			switch s.retryConflictedMR(ctx, r, mr) {
			case retryReopened:
				return true
			case retryReported:
				return false
			}
		}
		// Anything else is a gate the project requires and no amount of retrying
		// clears it. Report once and stop hammering the merge endpoint - the order
		// sits here until a person resolves it.
		s.reportMergeBlocked(ctx, r, mr, detailed)
		return false
	}

	merr := s.gl.MergeMR(ctx, mr.GitLabProjectID, mr.MRIID)
	observability.ObserveMRMerge(merr)
	if merr != nil {
		// GitLab passed the MR as mergeable and then refused the merge itself,
		// which is what a race with a sibling merging into the same branch looks
		// like. Expected and self-correcting, so Debug, but carry GitLab's reason.
		s.logger().Debug("mr auto-merge deferred",
			"order_id", r.ID, "mr_iid", mr.MRIID, "err", merr)
		return false
	}
	s.logger().Info("mr auto-merged", "order_id", r.ID, "mr_iid", mr.MRIID)
	s.forgetMergeBlocked(mr.ID)
	// Record the merge now rather than waiting for the next tick to observe it,
	// so the order reaches ArgoCD on this sweep.
	mr.Status = models.MRMerged
	if uerr := s.store.UpdateMR(ctx, mr); uerr != nil {
		s.logger().Warn("mr state persist failed",
			"order_id", r.ID, "mr_iid", mr.MRIID, "err", uerr)
	}
	return false
}

// reportMergeBlocked announces, once per reason per MR, that auto-merge has
// given up: a log line to read, a metric to alert on, and a timeline entry so
// the person looking at the order sees why it stopped moving.
func (s *Service) reportMergeBlocked(ctx context.Context, r *models.Request,
	mr *models.RequestMR, reason string) {

	s.mergeBlockedMu.Lock()
	if seen, ok := s.mergeBlocked[mr.ID]; ok && seen == reason {
		s.mergeBlockedMu.Unlock()
		return
	}
	s.mergeBlocked[mr.ID] = reason
	s.mergeBlockedMu.Unlock()

	observability.ObserveMRMergeBlocked(reason)
	s.logger().Warn("mr merge blocked",
		"order_id", r.ID, "mr_iid", mr.MRIID, "reason", reason)
	s.eventWith(ctx, r, bySystem(), "merge_blocked", "", "", map[string]any{"reason": reason})
}

// forgetMergeBlocked drops an MR from the reported set once it merges, so a
// later block on the same order is reported again.
func (s *Service) forgetMergeBlocked(mrID string) {
	s.mergeBlockedMu.Lock()
	delete(s.mergeBlocked, mrID)
	s.mergeBlockedMu.Unlock()
}

// deploySettled reports whether ArgoCD has finished applying the desired state
// (Synced), so a Healthy report reflects the merged change rather than a stale
// pre-sync read right after a merge. We rely on Sync status, not on matching a
// specific Git commit: instances of one chart share a single Git branch, so an
// app's revision tracks the whole branch (advanced by any sibling's MR) rather
// than this instance's own change - comparing exact commits would wedge unrelated
// instances in DEPLOYING. Only used while DEPLOYING (see reconcileOne).
func deploySettled(app *argocd.Application) bool {
	return app.Sync == argocd.SyncSynced
}

func mapHealth(h argocd.HealthStatus) models.RequestStatus {
	switch h {
	case argocd.HealthHealthy:
		return models.StatusHealthy
	case argocd.HealthProgressing:
		return models.StatusDeploying
	case argocd.HealthDegraded:
		return models.StatusDegraded
	case argocd.HealthMissing:
		return models.StatusArgoMissing
	default:
		return ""
	}
}

// tryTransition transitions, ignoring no-op and stale-version races (retried next tick).
func (s *Service) tryTransition(ctx context.Context, r *models.Request, to models.RequestStatus) {
	if r.Status == to {
		return
	}
	if !CanTransition(r.Status, to) {
		return
	}
	_ = s.transition(ctx, r, to, bySystem())
}

func (s *Service) markDeleted(ctx context.Context, r *models.Request) {
	if !CanTransition(r.Status, models.StatusDeleted) {
		return
	}
	now := time.Now()
	r.DeletedAt = &now
	r.Status = models.StatusDeleted
	if err := s.store.UpdateRequest(ctx, r); err != nil {
		return
	}
	s.event(ctx, r, bySystem(), "deleted", models.StatusDeleteMRMerged, models.StatusDeleted)
	s.publishStatus(r.ID, string(models.StatusDeleted))
	s.logger().Debug("order deleted", "order_id", r.ID)
}
