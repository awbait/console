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
			// An order holding an open merge request it never recorded is stuck for
			// good: the block on further changes reads the merge request, while
			// everything that would tend it reads the order's status, and the two
			// disagree. It happens when the change reached GitLab and the status
			// change after it did not - the two are not one write, and the second
			// can fail on its own (a concurrent poller bumping the row's version,
			// say). Put the order back on the status the open request implies, and
			// the machinery below picks it up on this same tick.
			if latest.Status == models.MROpened {
				s.recoverOpenMR(ctx, r, latest)
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
		if app, err := s.argo.GetApplication(ctx, r.ArgoCDAppName); err == nil {
			s.tryTransition(ctx, r, models.StatusDeploying)
			// Nudge ArgoCD to pull and apply the just-merged revision now instead
			// of waiting for its own git poll; reconcile then gates Healthy on it.
			// Not while an upgrade is still on its way into the application: a sync
			// run then is a sync of the previous chart version against the new
			// values, which fails on the chart's own schema (see upgradeInFlight).
			if !upgradeInFlight(r, app) {
				_ = s.argo.Sync(ctx, r.ArgoCDAppName)
			}
		}
	case models.StatusDeploying:
		// Freshly merged: wait until ArgoCD has actually finished syncing before
		// calling it Healthy, so we don't latch onto a stale pre-sync report.
		if app, err := s.argo.GetApplication(ctx, r.ArgoCDAppName); err == nil {
			if s.handleAppError(ctx, r, app) {
				return
			}
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
			if s.handleAppError(ctx, r, app) {
				return
			}
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
		// moved. A field both changes moved is the one case it cannot, and there
		// the change is taken back rather than left blocking the order.
		switch s.retryConflictedMR(ctx, r, mr) {
		case retryReopened:
			return true
		case retryWithdrawn:
			// The record now says closed, and the switch that follows in
			// reconcileOne takes the order off it. Nothing here to merge.
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

// How long a failing condition has to hold before the portal calls it an
// answer, when there is no sync operation to judge by. A condition outlives the
// state it describes: ArgoCD leaves it on the application until something makes
// it compare again, so a condition read once is as likely to be the remains of a
// moment that has passed as it is to be news.
const appErrorGrace = 3 * time.Minute

// How long to leave ArgoCD alone between two syncs the portal asks for itself.
// The reconciler comes back every few seconds and the operation it is waiting
// for takes longer than that to even start, so without this it would ask again
// before the previous answer existed.
const resyncCooldown = time.Minute

// upgradeInFlight reports that the application is still the version the order
// was on before, so nothing it says is about the version being ordered.
//
// An upgrade reaches the application in two steps that are not one transaction:
// the values.yaml of the order is read straight from the branch and is visible
// at once, while the new chart version is in the Application manifest and gets
// there only when the app-of-apps applies it. In between, the application is the
// old chart with the new values - which fails on the chart's own schema, loudly
// and truthfully, about a state nobody asked for.
func upgradeInFlight(r *models.Request, app *argocd.Application) bool {
	if app == nil || app.ChartVersion == "" || r.ChartVersion == "" {
		// An application whose chart version cannot be read is judged the way it
		// was before this existed: by what it reports about itself.
		return false
	}
	return app.ChartVersion != r.ChartVersion
}

// staleSyncFailure reports that the last sync failed on a chart version other
// than the one ordered - the failure belongs to what came before.
//
// ArgoCD will not retry it: an automated sync does not run again for a revision
// it has already tried, so the application sits there with the failure of the
// previous version on it and the new version never applied. Asking once more is
// the whole fix.
func staleSyncFailure(r *models.Request, app *argocd.Application) bool {
	op := app.LastOp
	if !op.Failed() || op.ChartVersion == "" || r.ChartVersion == "" {
		return false
	}
	return op.ChartVersion != r.ChartVersion
}

// errorOutlivedTheSync reports that the condition on the application is older
// than a sync that went through - it describes a state ArgoCD has since left.
func errorOutlivedTheSync(app *argocd.Application) bool {
	op := app.LastOp
	if op == nil || op.Failed() || op.FinishedAt.IsZero() || app.ErrorSince.IsZero() {
		return false
	}
	return app.ErrorSince.Before(op.FinishedAt)
}

// handleAppError decides what an application's complaint means for the order,
// and answers whether the caller should stop reading health off it.
//
// The order of the questions is the point. Whether the application is even the
// version the order asks for comes first, because until it is, both its error
// and its health are about the version before - and reporting either of them
// puts the wrong thing on the person's screen: a failure they did not cause, or
// a success for an upgrade that has not happened.
func (s *Service) handleAppError(ctx context.Context, r *models.Request, app *argocd.Application) bool {
	if app == nil {
		return false
	}
	if upgradeInFlight(r, app) {
		s.logger().Debug("upgrade has not reached the application yet",
			"order_id", r.ID, "argocd_app_name", r.ArgoCDAppName,
			"app_version", app.ChartVersion, "order_version", r.ChartVersion)
		return true
	}
	if staleSyncFailure(r, app) {
		s.resync(ctx, r, app)
		return true
	}
	if app.Error == "" || errorOutlivedTheSync(app) {
		return false
	}
	// A sync that failed on the ordered version is an answer as it stands. With
	// no sync to go by - an application ArgoCD cannot build never gets one - the
	// condition speaks for itself, once it has held long enough to mean anything.
	if !app.LastOp.Failed() && !app.ErrorSince.IsZero() && time.Since(app.ErrorSince) < appErrorGrace {
		return true
	}
	return s.reportAppError(ctx, r, app)
}

// resync asks ArgoCD to run the sync it will not run by itself, and leaves it
// alone for a while afterwards.
func (s *Service) resync(ctx context.Context, r *models.Request, app *argocd.Application) {
	if !s.takeResync(r.ID) {
		return
	}
	s.logger().Info("re-running a sync left failed on the previous version",
		"order_id", r.ID, "argocd_app_name", r.ArgoCDAppName,
		"failed_on", app.LastOp.ChartVersion, "order_version", r.ChartVersion)
	if err := s.argo.Sync(ctx, r.ArgoCDAppName); err != nil {
		s.logger().Warn("sync could not be re-run",
			"order_id", r.ID, "argocd_app_name", r.ArgoCDAppName, "err", err)
	}
}

// takeResync reports whether the portal may ask for a sync of this order now,
// recording the attempt. The reconciler runs every few seconds, and ArgoCD takes
// longer than that to even start an operation, so without a bound the portal
// would ask again before the previous answer could exist.
func (s *Service) takeResync(orderID string) bool {
	s.resyncMu.Lock()
	defer s.resyncMu.Unlock()
	if s.resyncedAt == nil {
		s.resyncedAt = map[string]time.Time{}
	}
	if at, asked := s.resyncedAt[orderID]; asked && time.Since(at) < resyncCooldown {
		return false
	}
	s.resyncedAt[orderID] = time.Now()
	return true
}

// reportAppError puts an order whose application ArgoCD cannot even build into
// DEGRADED, carrying what ArgoCD said. Returns true when the order has an error
// to answer for, so the caller stops reading health off it.
//
// An application that fails to render reports no health at all: the status stays
// Unknown, mapHealth answers with nothing, and the order sits wherever it was -
// DEPLOYING, usually - for as long as nobody notices. Meanwhile ArgoCD is
// holding the reason in plain words, down to the field of the values that broke
// the chart. This is that reason reaching the person whose order it is.
//
// Said once, on the way into DEGRADED. An order already in DEGRADED stays put
// with no second announcement: the poller comes back every few seconds, and a
// reason that is already on the card is not news. The cost is that an order
// degraded for some other reason and then failing to render keeps the older
// explanation, which is a fair trade against saying the same thing forever.
func (s *Service) reportAppError(ctx context.Context, r *models.Request, app *argocd.Application) bool {
	if app == nil || app.Error == "" {
		return false
	}
	from := r.Status
	if from == models.StatusDegraded {
		return true
	}
	s.tryTransition(ctx, r, models.StatusDegraded)
	if r.Status != models.StatusDegraded {
		// tryTransition has already said why it would not move.
		return true
	}
	observability.ObserveAppError()
	s.logger().Warn("argocd cannot build the application",
		"order_id", r.ID, "argocd_app_name", r.ArgoCDAppName, "err", app.Error)
	s.eventWith(ctx, r, bySystem(), "app_error", from, models.StatusDegraded,
		map[string]any{"error": app.Error})
	if s.notify != nil {
		s.notify.OrderDegraded(ctx, nil, r, app.Error)
	}
	return true
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
		// Not routine, and not silent any more. A refusal means the caller read the
		// order as being somewhere it is not, and the order stays where it was with
		// nobody told - which is how an order can sit wrong for hours without
		// producing a single line to look at.
		observability.ObserveTransitionRefused(string(r.Status), string(to))
		s.logger().Warn("order transition refused",
			"order_id", r.ID, "from", r.Status, "to", to)
		return
	}
	_ = s.transition(ctx, r, to, bySystem())
}

// recoverOpenMR brings an order back to the status its open merge request
// implies, when the order is somewhere that does not admit an open one.
//
// The order is the authority on what is being asked for; the merge request is
// the authority on whether it was asked. When they disagree this way, the merge
// request is right: it exists in GitLab, and something opened it. Left alone the
// order is blocked for good - guardOpenMR refuses every further change because a
// request is open, while reconcile tends open requests only for the two statuses
// that expect one, so nothing ever merges it or reports it.
//
// A no-op in the ordinary case, where the order already says what the request
// says.
func (s *Service) recoverOpenMR(ctx context.Context, r *models.Request, mr *models.RequestMR) {
	want := models.StatusMRCreated
	if mr.Action == models.ActionDelete {
		want = models.StatusDeleteRequested
	}
	if r.Status == want || r.Status == models.StatusMRCreated || r.Status == models.StatusDeleteRequested {
		return
	}
	from := r.Status
	s.tryTransition(ctx, r, want)
	if r.Status != want {
		// tryTransition has already said why. Nothing else to do here: an order the
		// state machine will not move is one a person has to look at.
		return
	}
	observability.ObserveOrderRecovered(string(want))
	s.logger().Warn("order recovered from an unrecorded change",
		"order_id", r.ID, "mr_iid", mr.MRIID, "from", from, "to", want)
	s.eventWith(ctx, r, bySystem(), "change_recovered", want, want, map[string]any{
		"mr_iid": mr.MRIID,
		"from":   string(from),
	})
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
