package provisioning

import (
	"context"
	"errors"
	"time"

	"console/internal/argocd"
	"console/internal/gitlab"
	"console/internal/observability"
	"console/internal/views"
	"console/pkg/models"
)

// Reconcile advances every active order based on its MR and ArgoCD state.
// It is mode-agnostic (works against real or fake upstreams) and idempotent,
// so the poller can call it on every tick.
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
			if latest.Status == models.MROpened &&
				(r.Status == models.StatusMRCreated || r.Status == models.StatusDeleteRequested) {
				// A change rewritten onto a moved branch leaves this record pointing
				// at the merge request it replaced, now closed. Reading the order's
				// state off it would call the order abandoned; it has a new change
				// open instead, which the next tick picks up.
				if s.tendOpenMR(ctx, r, latest, live.DetailedMergeStatus) {
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
				s.tryTransition(ctx, r, closedChangeTarget(latest.Action))
			}
		case models.StatusDeleteRequested:
			switch latest.Status {
			case models.MRMerged:
				s.tryTransition(ctx, r, models.StatusDeleteMRMerged)
			case models.MRClosed:
				s.tryTransition(ctx, r, closedChangeTarget(latest.Action))
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
		s.tendDelete(ctx, r)
	}
}

// deleteGrace is how long taking a service out of the cluster may take before the
// portal says out loud that it is not finishing. Generous on purpose: the merged
// change reaches Argo CD through its own Git poll (minutes, on an installation
// with no webhook from GitLab), and Argo CD then removes the deployed resources
// one by one. Past this it is not slowness - something in the cluster is refusing
// to go, and only somebody with access there can find out what.
const deleteGrace = 15 * time.Minute

// tendDelete finishes, or explains, one order whose delete change is merged.
//
// The Application outliving its manifest is the normal middle of a deletion, not
// a fault: the manifest carries Argo CD's resources finalizer (see gitops.go), so
// Argo CD keeps the Application until everything it deployed is gone. That is
// what makes its disappearance proof that the service is really gone, and why the
// order is closed on it rather than on the merge.
func (s *Service) tendDelete(ctx context.Context, r *models.Request) {
	_, err := s.argo.GetApplication(ctx, r.ArgoCDAppName)
	switch {
	case errors.Is(err, models.ErrNotFound):
		s.markDeleted(ctx, r)
	case err != nil:
		// Argo CD is not answering. Nothing follows from that about the service,
		// and the status page is already saying the integration is down.
		s.logger().Debug("delete: argocd state unavailable",
			"order_id", r.ID, "argocd_app_name", r.ArgoCDAppName, "err", err)
	case time.Since(r.UpdatedAt) > deleteGrace:
		// UpdatedAt is when the order entered this status: nothing else writes the
		// row while a delete is in flight.
		s.logger().Warn("delete not finishing",
			"order_id", r.ID, "argocd_app_name", r.ArgoCDAppName,
			"waiting_for", time.Since(r.UpdatedAt).Round(time.Minute).String())
		if s.notify != nil {
			s.notify.OrderDeleteStalled(ctx, nil, r)
		}
	}
}

// tendOpenMR looks after one open portal merge request on every poller tick.
// Two jobs, deliberately separate:
//
//   - keeping the change mergeable. A change the branch has moved out from under
//     is rewritten on top of it, whoever is going to press the button. This is
//     not merging - it is what turns a conflict a person cannot resolve on the
//     order form into a change they can simply approve.
//   - merging it, when the installation and the service both allow the portal to
//     do that without a person.
//
// detailed is GitLab's detailed_merge_status. Reports whether the merge request
// it was given has been superseded by a rewritten one, in which case the caller
// is holding a stale record.
func (s *Service) tendOpenMR(ctx context.Context, r *models.Request, mr *models.RequestMR, detailed string) (superseded bool) {
	if gitlab.ClassifyMerge(detailed) == gitlab.MergeBlocked && detailed == "conflict" {
		// A conflict is the one blocked state the portal can clear by itself: the
		// change is still good, it was written against a branch that has since
		// moved. Only a field both changes moved needs a person.
		switch s.retryConflictedMR(ctx, r, mr) {
		case retryReopened:
			return true
		case retryReported:
			return false
		}
	}
	if !s.mayAutoMerge(ctx, r) {
		return false
	}
	s.autoMergeMR(ctx, r, mr, detailed)
	return false
}

// Who asks for a person to read this order's changes (Review.By).
const (
	// ReviewByInstallation: this portal merges nothing without a person
	// (GITLAB_AUTO_MERGE is off), whatever the service says.
	ReviewByInstallation = "installation"
	// ReviewByService: the version's own document refuses unattended merges.
	ReviewByService = "service"
)

// Review says how an order's changes reach the cluster: on their own, or only
// after a person has read them, and who asks for that. It exists so the order
// page can tell the truth about the wait instead of promising an approval that,
// where the portal merges its own changes, never happens.
type Review struct {
	Required bool   `json:"required"`
	By       string `json:"by,omitempty"` // meaningless unless Required
}

// OrderReview answers that for one order. The installation's GITLAB_AUTO_MERGE
// is the ceiling; the version's view document may refuse below it, which is how
// a service whose every change has to be read by a person (network policies,
// anything the security team owns) says so - in the service's own document
// rather than in the portal's configuration.
func (s *Service) OrderReview(ctx context.Context, r *models.Request) Review {
	if !s.autoMerge {
		return Review{Required: true, By: ReviewByInstallation}
	}
	view := s.orderView(ctx, r.ChartProject, r.ChartName, r.ChartVersion)
	if views.AutoMergeAllowed(view, true) {
		return Review{}
	}
	return Review{Required: true, By: ReviewByService}
}

// mayAutoMerge reports whether the portal may merge this order's change itself.
// The same question the order page asks, answered from the same place: what the
// poller does and what the page promises cannot drift apart.
func (s *Service) mayAutoMerge(ctx context.Context, r *models.Request) bool {
	rev := s.OrderReview(ctx, r)
	if !rev.Required {
		return true
	}
	if rev.By == ReviewByService {
		// Debug, and every tick: an order sitting in MR_CREATED with nothing
		// happening is exactly what someone comes to the log to explain.
		s.logger().Debug("auto-merge declined by the service",
			"order_id", r.ID, "chart", r.ChartName, "version", r.ChartVersion)
	}
	return false
}

// autoMergeMR merges one open portal MR when GitLab says it will accept it.
// The poller calls this for every open MR on every tick, so it has to stay
// quiet while GitLab is still deciding and speak up exactly once when the MR
// will never merge on its own. detailed is GitLab's detailed_merge_status.
func (s *Service) autoMergeMR(ctx context.Context, r *models.Request, mr *models.RequestMR, detailed string) {
	switch gitlab.ClassifyMerge(detailed) {
	case gitlab.MergePending:
		// Mergeability is computed asynchronously. A just-opened MR, or one whose
		// target branch a sibling order has just advanced, reads as pending for a
		// tick or two and then merges by itself - nothing to report. A change
		// GitLab is still deciding on half an hour later is stuck whatever it
		// says, so that much waiting is reported like any other block.
		s.logger().Debug("mr merge pending",
			"order_id", r.ID, "mr_iid", mr.MRIID, "reason", detailed)
		s.reportMergeBlocked(ctx, r, mr, detailed, mergeStuck)
		return
	case gitlab.MergeBlocked:
		// A gate the project requires, and no amount of retrying clears it (the
		// one the portal can clear, a conflict, was handled before we got here).
		// Report once and stop hammering the merge endpoint - the order sits here
		// until a person resolves it.
		s.reportMergeBlocked(ctx, r, mr, detailed, mergeGrace)
		return
	}

	merr := s.gl.MergeMR(ctx, mr.GitLabProjectID, mr.MRIID)
	observability.ObserveMRMerge(merr)
	if merr != nil {
		// GitLab passed the MR as mergeable and then refused the merge itself,
		// which is what a race with a sibling merging into the same branch looks
		// like. Expected and self-correcting, so Debug, but carry GitLab's reason.
		s.logger().Debug("mr auto-merge deferred",
			"order_id", r.ID, "mr_iid", mr.MRIID, "err", merr)
		return
	}
	s.logger().Info("mr auto-merged", "order_id", r.ID, "mr_iid", mr.MRIID)
	s.clearMergeRetries(r.ID)
	// Record the merge now rather than waiting for the next tick to observe it,
	// so the order reaches ArgoCD on this sweep.
	mr.Status = models.MRMerged
	mr.BlockedReason = ""
	if uerr := s.store.UpdateMR(ctx, mr); uerr != nil {
		s.logger().Warn("mr state persist failed",
			"order_id", r.ID, "mr_iid", mr.MRIID, "err", uerr)
	}
}

// How long a change may go unmerged before the portal says so out loud.
//
// mergeGrace covers a refusal GitLab has settled on: it is already an answer, so
// the wait is only there because mergeability is recomputed constantly and a
// change can read as refused for a moment right after it is opened.
//
// mergeStuck covers a change GitLab says it is still deciding on. That is not an
// answer, and it is normally over in seconds, so the portal waits much longer
// before calling it a problem - long enough that a slow pipeline finishes on its
// own, short enough that nobody has to notice the order by themselves.
const (
	mergeGrace = 5 * time.Minute
	mergeStuck = 30 * time.Minute
)

// reportMergeBlocked announces, once per reason per change, that auto-merge has
// given up: a log line to read, a metric to alert on, a timeline entry so the
// person looking at the order sees why it stopped moving, and a notification so
// they do not have to be looking. after is how long the change has to have been
// in this state before any of that is worth saying.
func (s *Service) reportMergeBlocked(ctx context.Context, r *models.Request,
	mr *models.RequestMR, reason string, after time.Duration) {

	if !s.takeMergeBlock(ctx, r, mr, reason, after) {
		return
	}
	observability.ObserveMRMergeBlocked(reason)
	s.logger().Warn("mr merge blocked",
		"order_id", r.ID, "mr_iid", mr.MRIID, "reason", reason)
	s.eventWith(ctx, r, bySystem(), "merge_blocked", "", "", map[string]any{"reason": reason})
	if s.notify != nil {
		s.notify.OrderChangeBlocked(ctx, nil, r, reason)
	}
}

// takeMergeBlock reports whether this refusal is news, and records it if it is.
// key is what makes one refusal the same as another: GitLab's status, or the
// fields two changes disagree on.
//
// The record lives on the merge request row rather than in memory, because "we
// already said this" has to survive a restart of the portal: it did not, and
// every deploy re-announced the same block on every change waiting for a person.
func (s *Service) takeMergeBlock(ctx context.Context, r *models.Request,
	mr *models.RequestMR, key string, after time.Duration) bool {

	if mr.BlockedReason == key {
		return false
	}
	// after == 0 means say it now, with no clock reading at all: the caller has
	// something to report that no amount of waiting changes.
	if after > 0 && time.Since(mr.CreatedAt) < after {
		s.logger().Debug("mr not mergeable yet",
			"order_id", r.ID, "mr_iid", mr.MRIID, "reason", key)
		return false
	}
	mr.BlockedReason = key
	if err := s.store.UpdateMR(ctx, mr); err != nil {
		// Say it anyway. Repeating ourselves after a restart is better than an
		// order that stopped moving with nothing anywhere to say why.
		s.logger().Warn("mr block reason not persisted",
			"order_id", r.ID, "mr_iid", mr.MRIID, "err", err)
	}
	return true
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

// closedChangeTarget is where an order goes when its change was closed instead
// of merged. What that means depends on what the change was for.
//
// A closed FIRST order is the only one that means there is no service: nothing
// was ever created, and MR_CLOSED - a terminal state - says so. An edit or a
// deletion is a change to a service that is already running, and closing it
// leaves that service exactly as it was, so the order goes back to MR_MERGED
// (its manifests are in Git) and the ArgoCD sweep in reconcileOne settles its
// real state from there. It used to go to MR_CLOSED as well, which killed a live order:
// nothing leaves MR_CLOSED, so the service could no longer be edited, upgraded
// or even deleted through the portal, and ListActive stopped handing it to the
// poller and the drift check.
//
// An action this build does not know keeps the old behaviour: a change we
// cannot classify is not one to declare a service alive on.
func closedChangeTarget(action models.MRAction) models.RequestStatus {
	switch action {
	case models.ActionUpdate, models.ActionDelete:
		return models.StatusMRMerged
	default:
		return models.StatusMRClosed
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
