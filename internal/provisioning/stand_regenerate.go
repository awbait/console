package provisioning

import (
	"context"
	"errors"
	"time"

	"console/internal/gitlab"
	"console/internal/store"
	"console/pkg/models"
)

// Regenerating a stand's applications: writing every order's application.yaml
// again from the stand's current settings. A stand's project, namespace,
// registry, Git address or Argo CD path reach an order's manifest only when
// the manifest is written next, which for a quiet order is never; this job
// writes them all, through the ordinary change of each order, and leaves
// alone the ones whose manifest in Git already says the same.
//
// An order counts as updated once its change is open, not once it merged:
// with automerge off the job would otherwise wait on people. Each order is
// looked at once (StandJob.Handled), because an updated order, merged, looks
// no different from one not yet looked at.

// MsgRegenerateMode is what a stand that keeps its orders in the portal
// answers: there is no file in Git to write again.
const MsgRegenerateMode = "Нельзя перегенерировать application.yaml: в режиме «Только портал» файлы заказа в GitLab не создаются."

// regenerateSubject reports whether an order is one a regeneration writes:
// placed, not on its way out, and with its files in Git or on their way
// there. An order Argo CD does not see is included: the setting being
// changed may be the very reason it is not seen. An order whose own change
// is open is included too, and waited on: the manifest that change carries
// is looked at once it lands.
func regenerateSubject(r *models.Request) bool {
	if !jobSubject(r) {
		return false
	}
	switch r.Status {
	case models.StatusArgoMissing, models.StatusMRCreated:
		return true
	}
	return driftCheckable(r.Status)
}

// countRegenerate is how many orders of the stand a regeneration would look
// at: what the confirmation names before anything is started.
func (s *Service) countRegenerate(ctx context.Context, standID string) (int, error) {
	orders, err := s.store.ListRequests(ctx, store.RequestFilter{Admin: true, Stand: standID})
	if err != nil {
		return 0, err
	}
	n := 0
	for _, r := range orders {
		if regenerateSubject(r) {
			n++
		}
	}
	return n, nil
}

// PreviewRegenerate answers how many orders a regeneration of the stand
// would look at, and refuses the way starting one would. Admin only.
func (s *Service) PreviewRegenerate(ctx context.Context, u *models.User, standID string) (int, error) {
	if !u.IsAdmin() {
		return 0, ErrForbidden
	}
	st, err := s.GetStand(ctx, standID)
	if err != nil {
		return 0, err
	}
	if !st.WritesGit() {
		return 0, &ValidationError{Message: MsgRegenerateMode}
	}
	return s.countRegenerate(ctx, st.ID)
}

// RegenerateStand starts the job that writes every order's application.yaml
// again. Admin only; one job per stand at a time, like the others, and
// nothing to do on a stand whose orders are not in Git.
func (s *Service) RegenerateStand(ctx context.Context, u *models.User, standID string) (*models.StandJob, error) {
	if !u.IsAdmin() {
		return nil, ErrForbidden
	}
	st, err := s.GetStand(ctx, standID)
	if err != nil {
		return nil, err
	}
	if !st.WritesGit() {
		return nil, &ValidationError{Message: MsgRegenerateMode}
	}
	if st.Job != nil {
		return nil, &ValidationError{Message: MsgStandJobRunning}
	}
	total, err := s.countRegenerate(ctx, st.ID)
	if err != nil {
		return nil, err
	}
	j := &models.StandJob{
		ID: newID(), StandID: st.ID, Kind: models.StandJobRegenerate,
		FromMode: st.Mode, ToMode: st.Mode, Status: models.StandJobRunning,
		Total: total, Handled: map[string]string{}, CreatedBy: u.Subject,
	}
	if err := s.store.CreateStandJob(ctx, j); err != nil {
		if errors.Is(err, models.ErrConflict) {
			return nil, &ValidationError{Message: MsgStandJobRunning}
		}
		return nil, err
	}
	s.logger().Info("stand regeneration started", "stand", st.ID, "stand_name", st.Name, "job", j.ID, "orders", total, "actor", u.Subject)
	return j, nil
}

// advanceRegenerateJob runs one pass of a regeneration: recounts the orders,
// looks at up to a batch of those not looked at yet, and finishes once every
// order is updated, skipped or given up on. A change the job opened and
// somebody closed without merging is a failure, as in the mode job.
func (s *Service) advanceRegenerateJob(ctx context.Context, j *models.StandJob, st *models.Stand) error {
	orders, err := s.store.ListRequests(ctx, store.RequestFilter{Admin: true, Stand: st.ID})
	if err != nil {
		return err
	}
	if j.Handled == nil {
		j.Handled = map[string]string{}
	}
	failed := map[string]bool{}
	for _, f := range j.Failures {
		failed[f.OrderID] = true
	}
	total, updated, skipped, waiting, budget := 0, 0, 0, 0, standJobBatch
	for _, r := range orders {
		// An order the job has already written is in MR_CREATED, or merged
		// and on its way: it is counted by the job's own record, not by its
		// status. Everything else is a subject by its status alone.
		handled := j.Handled[r.ID]
		if handled == "" && !failed[r.ID] && !regenerateSubject(r) {
			continue
		}
		total++
		if failed[r.ID] {
			continue
		}
		switch handled {
		case models.StandJobSkipped:
			skipped++
			continue
		case models.StandJobUpdated:
			// Open or merged, the change is the order's to finish. Closed
			// without merging, the new manifest never landed.
			if mr, err := s.latestRegenerateMR(ctx, r.ID, j); err != nil {
				return err
			} else if mr != nil && mr.Status == models.MRClosed {
				j.Failures = append(j.Failures, models.StandJobFailure{
					OrderID: r.ID, ServiceName: r.ServiceName, Reason: jobFailMRClosed,
				})
				failed[r.ID] = true
				delete(j.Handled, r.ID)
				continue
			}
			updated++
			continue
		}
		if r.Status == models.StatusMRCreated {
			waiting++ // the order's own change is open; it carries one at a time
			continue
		}
		if mr, err := s.store.GetOpenMR(ctx, r.ID); err == nil && mr != nil {
			waiting++
			continue
		} else if err != nil && !errors.Is(err, models.ErrNotFound) {
			return err
		}
		if budget == 0 {
			continue
		}
		budget--
		changed, err := s.regenerateOrder(ctx, r, st)
		if err != nil {
			f := models.StandJobFailure{OrderID: r.ID, ServiceName: r.ServiceName, Reason: jobFailUpstream, Detail: err.Error()}
			var verr *ValidationError
			if errors.As(err, &verr) {
				f.Reason, f.Detail = jobFailRejected, verr.Message
			}
			j.Failures = append(j.Failures, f)
			failed[r.ID] = true
			s.logger().Warn("stand regeneration could not write an order", "stand", st.ID, "job", j.ID, "order_id", r.ID, "err", err)
			continue
		}
		if changed {
			j.Handled[r.ID] = models.StandJobUpdated
			updated++
		} else {
			j.Handled[r.ID] = models.StandJobSkipped
			skipped++
		}
	}
	j.Total, j.Done, j.Skipped, j.Waiting = total, updated, skipped, waiting
	if updated+skipped+len(failed) >= total {
		now := time.Now()
		j.Status, j.FinishedAt = models.StandJobDone, &now
		s.logger().Info("stand regeneration done", "stand", st.ID, "job", j.ID, "updated", updated, "skipped", skipped, "failed", len(failed))
	}
	return s.store.UpdateStandJob(ctx, j)
}

// latestRegenerateMR is the change this job opened on the order, if the
// order's latest change is one: nil when the latest is somebody else's or
// predates the job.
func (s *Service) latestRegenerateMR(ctx context.Context, orderID string, j *models.StandJob) (*models.RequestMR, error) {
	mrs, err := s.store.ListMRs(ctx, orderID)
	if err != nil {
		return nil, err
	}
	if len(mrs) == 0 {
		return nil, nil
	}
	latest := mrs[len(mrs)-1]
	if latest.Action != models.ActionRegenerate || latest.CreatedAt.Before(j.CreatedAt) {
		return nil, nil
	}
	return latest, nil
}

// regenerateOrder renders the order's application against its stand and
// compares it with the manifest on the default branch. The same: nothing is
// opened and false comes back. Different, or missing from Git altogether: a
// change with the one file is opened and the order goes for approval, the
// way an edit sends it. Values are not part of the change.
func (s *Service) regenerateOrder(ctx context.Context, r *models.Request, st *models.Stand) (bool, error) {
	proj, err := s.gl.GetProject(ctx, s.gitops.RepoPath(st, r.Team, r.ChartName))
	if err != nil {
		return false, gitopsErr("resolve repo", err)
	}
	branch := proj.DefaultBranch
	if branch == "" {
		branch = s.defaultBranch
	}
	appYAML, err := s.renderApp(r, st, proj.PathWithNamespace, proj.WebURL)
	if err != nil {
		return false, err
	}
	action := "update"
	switch current, err := s.gl.GetFile(ctx, proj.ID, s.gitops.AppPath(r), branch); {
	case errors.Is(err, models.ErrNotFound):
		action = "create" // taken out of Git by hand: the regeneration puts it back
	case err != nil:
		return false, gitopsErr("read application.yaml", err)
	case yamlEqual(current, []byte(appYAML)):
		return false, nil
	}
	actions := []gitlab.FileAction{{Action: action, FilePath: s.gitops.AppPath(r), Content: appYAML}}
	if _, err := s.openChange(ctx, r, proj, models.ActionRegenerate, actions); err != nil {
		return false, err
	}
	return true, s.transitionAfterChange(ctx, r, models.StatusMRCreated, bySystem())
}
