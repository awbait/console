package provisioning

import (
	"context"
	"errors"
	"time"

	"console/internal/gitlab"
	"console/internal/store"
	"console/pkg/models"
)

// Stand jobs: moving the orders of a stand to the mode the stand was just
// switched to. The stand's mode changes at once, so every new order already
// follows it; the job catches the existing ones up, a few per pass, on the
// poller. Moving an order is one change per order, and an order carries one
// open change at a time, so the job waits on whatever is open and comes back.
//
// What moves where:
//
//	console -> git, deploy  a merge request writes the order's files (publish)
//	git     -> deploy       nothing to write: the order goes back to MR_MERGED
//	                        and the reconciler follows Argo CD from there
//	git     -> console      a merge request takes the files out (unpublish)
//
// Leaving deploy is not a job: an order Argo CD deployed would be taken down
// by its app-of-apps the moment its files go, so the stand has to be emptied
// first (MsgStandDeployLeave).

// standJobBatch is how many changes one pass of a job opens. A stand of a
// thousand orders should not open a thousand merge requests in one tick.
const standJobBatch = 10

// Failure reasons a job records against an order; the front end words them.
const (
	jobFailMRClosed = "mr_closed" // the change moving the order was closed without merging
	jobFailRejected = "rejected"  // the portal refused to move the order, Detail says why
	jobFailUpstream = "upstream"  // GitLab or Argo CD failed, Detail has their words
)

// What a stand job says when it refuses, product-toned like the rest.
const (
	MsgStandDeployLeave   = "Чтобы сменить режим «Развёртывание», сначала удалите заказы стенда. Черновики и удалённые заказы не мешают смене режима."
	MsgStandJobRunning    = "Заказы переходят в новый режим. Пока переход не завершён или не остановлен, изменить режим, способ хранения в GitLab и путь нельзя."
	MsgStandJobNotRunning = "Нельзя остановить задачу: она уже завершена или остановлена."
)

// jobSubject reports whether an order is one a job moves: placed, not on its
// way out and not turned down.
func jobSubject(r *models.Request) bool {
	if r.DeletedAt != nil {
		return false
	}
	switch r.Status {
	case models.StatusDraft, models.StatusDeleted, models.StatusMRClosed,
		models.StatusDeleteRequested, models.StatusDeleteMRMerged:
		return false
	}
	return true
}

// jobArrived reports whether an order is where a stand of this mode keeps it.
func jobArrived(mode string, st models.RequestStatus) bool {
	switch mode {
	case models.ModeGit:
		return st == models.StatusGitSaved
	case models.ModeConsole:
		return st == models.StatusConsoleSaved
	default:
		switch st {
		case models.StatusMRMerged, models.StatusDeploying, models.StatusHealthy,
			models.StatusDegraded, models.StatusArgoMissing:
			return true
		}
		return false
	}
}

// runningJob is the job running on the stand, or nil.
func (s *Service) runningJob(ctx context.Context, standID string) (*models.StandJob, error) {
	jobs, err := s.store.ListStandJobs(ctx, standID)
	if err != nil {
		return nil, err
	}
	for _, j := range jobs {
		if j.Status == models.StandJobRunning {
			return j, nil
		}
	}
	return nil, nil
}

// startModeJob records the job that moves the stand's orders from one mode
// to the other. The first pass is the poller's.
func (s *Service) startModeJob(ctx context.Context, u *models.User, st *models.Stand, from string) (*models.StandJob, error) {
	j := &models.StandJob{
		ID: newID(), StandID: st.ID, Kind: models.StandJobModeChange,
		FromMode: from, ToMode: st.Mode, Status: models.StandJobRunning,
		CreatedBy: u.Subject,
	}
	// Counted now, so the stand reads "0 of N" before the first pass rather
	// than "0 of 0"; every pass recounts.
	orders, err := s.store.ListRequests(ctx, store.RequestFilter{Admin: true, Stand: st.ID})
	if err != nil {
		return nil, err
	}
	for _, r := range orders {
		if jobSubject(r) {
			j.Total++
		}
	}
	if err := s.store.CreateStandJob(ctx, j); err != nil {
		if errors.Is(err, models.ErrConflict) {
			return nil, &ValidationError{Message: MsgStandJobRunning}
		}
		return nil, err
	}
	s.logger().Info("stand job started", "stand", st.ID, "job", j.ID, "from", from, "to", st.Mode, "actor", u.Subject)
	return j, nil
}

// ListStandJobs returns the stand's jobs, newest first. Admin only, like the
// stand page that shows them.
func (s *Service) ListStandJobs(ctx context.Context, u *models.User, standID string) ([]*models.StandJob, error) {
	if !u.IsAdmin() {
		return nil, ErrForbidden
	}
	if _, err := s.store.GetStand(ctx, standID); err != nil {
		return nil, err
	}
	return s.store.ListStandJobs(ctx, standID)
}

// StopStandJob stops a running job. What it moved stays moved; what it did not
// stays where it was, and a change it opened is left to finish on its own,
// because closing it would only leave an order between two places.
func (s *Service) StopStandJob(ctx context.Context, u *models.User, standID, jobID string) (*models.StandJob, error) {
	if !u.IsAdmin() {
		return nil, ErrForbidden
	}
	j, err := s.store.GetStandJob(ctx, jobID)
	if err != nil {
		return nil, err
	}
	if j.StandID != standID {
		return nil, models.ErrNotFound
	}
	if j.Status != models.StandJobRunning {
		return nil, &ValidationError{Message: MsgStandJobNotRunning}
	}
	now := time.Now()
	j.Status, j.FinishedAt = models.StandJobStopped, &now
	if err := s.store.UpdateStandJob(ctx, j); err != nil {
		return nil, err
	}
	s.logger().Info("stand job stopped", "stand", standID, "job", j.ID, "actor", u.Subject)
	return j, nil
}

// RunStandJobs is one pass of every running job: the poller's. A job whose
// stand is gone is stopped.
func (s *Service) RunStandJobs(ctx context.Context) error {
	jobs, err := s.store.ListRunningStandJobs(ctx)
	if err != nil {
		return err
	}
	var first error
	for _, j := range jobs {
		if err := s.advanceJob(ctx, j); err != nil {
			s.logger().Warn("stand job pass failed", "stand", j.StandID, "job", j.ID, "err", err)
			if first == nil {
				first = err
			}
		}
	}
	return first
}

// advanceJob runs one pass of a job: recounts where the stand's orders are,
// moves up to a batch of those that are not there yet, and finishes the job
// once every order has arrived or been given up on.
func (s *Service) advanceJob(ctx context.Context, j *models.StandJob) error {
	st, err := s.store.GetStand(ctx, j.StandID)
	if errors.Is(err, models.ErrNotFound) || (err == nil && st.DeletedAt != nil) {
		now := time.Now()
		j.Status, j.FinishedAt = models.StandJobStopped, &now
		return s.store.UpdateStandJob(ctx, j)
	}
	if err != nil {
		return err
	}
	if j.Kind == models.StandJobDelete {
		return s.advanceDeleteJob(ctx, j, st)
	}
	orders, err := s.store.ListRequests(ctx, store.RequestFilter{Admin: true, Stand: st.ID})
	if err != nil {
		return err
	}
	failed := map[string]bool{}
	for _, f := range j.Failures {
		failed[f.OrderID] = true
	}
	total, done, waiting, budget := 0, 0, 0, standJobBatch
	for _, r := range orders {
		if !jobSubject(r) {
			continue
		}
		total++
		if failed[r.ID] {
			continue
		}
		if jobArrived(j.ToMode, r.Status) {
			done++
			continue
		}
		mrs, err := s.store.ListMRs(ctx, r.ID)
		if err != nil {
			return err
		}
		if len(mrs) > 0 {
			latest := mrs[len(mrs)-1]
			if latest.Status == models.MROpened {
				waiting++ // a change is on its way, ours or the owner's
				continue
			}
			ours := latest.Action == models.ActionPublish || latest.Action == models.ActionUnpublish
			if ours && latest.Status == models.MRClosed && !latest.CreatedAt.Before(j.CreatedAt) {
				j.Failures = append(j.Failures, models.StandJobFailure{
					OrderID: r.ID, ServiceName: r.ServiceName, Reason: jobFailMRClosed,
				})
				failed[r.ID] = true
				continue
			}
		}
		if budget == 0 {
			continue
		}
		budget--
		moved, err := s.moveOrder(ctx, r, st, j.ToMode)
		if err != nil {
			f := models.StandJobFailure{OrderID: r.ID, ServiceName: r.ServiceName, Reason: jobFailUpstream, Detail: err.Error()}
			var verr *ValidationError
			if errors.As(err, &verr) {
				f.Reason, f.Detail = jobFailRejected, verr.Message
			}
			j.Failures = append(j.Failures, f)
			failed[r.ID] = true
			s.logger().Warn("stand job could not move an order", "stand", st.ID, "job", j.ID, "order_id", r.ID, "err", err)
			continue
		}
		switch {
		case jobArrived(j.ToMode, r.Status):
			done++
		case moved:
			waiting++
		}
	}
	j.Total, j.Done, j.Waiting = total, done, waiting
	if done+len(failed) >= total {
		now := time.Now()
		j.Status, j.FinishedAt = models.StandJobDone, &now
		s.logger().Info("stand job done", "stand", st.ID, "job", j.ID, "moved", done, "failed", len(failed))
	}
	return s.store.UpdateStandJob(ctx, j)
}

// moveOrder takes one order a step towards the stand's new mode. It reports
// whether it did anything: an order in between (a merged change the
// reconciler has not filed yet) is left for the next pass.
func (s *Service) moveOrder(ctx context.Context, r *models.Request, st *models.Stand, to string) (bool, error) {
	switch {
	case to != models.ModeConsole && r.Status == models.StatusConsoleSaved:
		return true, s.publishOrder(ctx, r, st)
	case to == models.ModeDeploy && r.Status == models.StatusGitSaved:
		// The files are in Git already: from MR_MERGED the reconciler looks for
		// the application in Argo CD, as for any merged order.
		return true, s.transitionAfterChange(ctx, r, models.StatusMRMerged, bySystem())
	case to == models.ModeConsole && r.Status == models.StatusGitSaved:
		return true, s.unpublishOrder(ctx, r, st)
	}
	return false, nil
}

// publishOrder writes the files of an order kept in the portal into Git, the
// way placing it on the stand would have.
func (s *Service) publishOrder(ctx context.Context, r *models.Request, st *models.Stand) error {
	proj, err := s.ensureRepo(ctx, st, r.Team, r.ChartName)
	if err != nil {
		return err
	}
	appYAML, err := s.renderApp(r, st, proj.PathWithNamespace, proj.WebURL)
	if err != nil {
		return err
	}
	actions := []gitlab.FileAction{
		{Action: "create", FilePath: s.gitops.AppPath(r), Content: appYAML},
		{Action: "create", FilePath: s.gitops.ValuesPath(r), Content: r.ValuesYAML},
	}
	if _, err := s.openChange(ctx, r, proj, models.ActionPublish, actions); err != nil {
		return err
	}
	return s.transitionAfterChange(ctx, r, models.StatusMRCreated, bySystem())
}

// unpublishOrder takes an order's files out of Git and keeps the order in the
// portal. Files that are already gone leave nothing to merge.
func (s *Service) unpublishOrder(ctx context.Context, r *models.Request, st *models.Stand) error {
	proj, err := s.gl.GetProject(ctx, s.gitops.RepoPath(st, r.Team, r.ChartName))
	if errors.Is(err, models.ErrNotFound) {
		return s.transitionAfterChange(ctx, r, models.StatusConsoleSaved, bySystem())
	}
	if err != nil {
		return gitopsErr("resolve repo", err)
	}
	files, err := s.gl.ListTree(ctx, proj.ID, s.defaultBranch, s.gitops.InstanceDir(r))
	if err != nil {
		return gitopsErr("list tree", err)
	}
	if len(files) == 0 {
		return s.transitionAfterChange(ctx, r, models.StatusConsoleSaved, bySystem())
	}
	actions := make([]gitlab.FileAction, 0, len(files))
	for _, f := range files {
		actions = append(actions, gitlab.FileAction{Action: "delete", FilePath: f})
	}
	if _, err := s.openChange(ctx, r, proj, models.ActionUnpublish, actions); err != nil {
		return err
	}
	return s.transitionAfterChange(ctx, r, models.StatusMRCreated, bySystem())
}
