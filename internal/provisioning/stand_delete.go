package provisioning

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"console/internal/store"
	"console/pkg/models"
)

// Deleting a stand: a job that deletes every order of the stand the ordinary
// way (a draft and a console-only order at once, the rest through a delete
// merge request and, on a deploying stand, Argo CD taking the service down),
// and then the stand itself, its variable values, and the group or repository
// the portal made for it in GitLab. An order the job cannot delete keeps the
// stand: the job lists it, and the admin deals with it and starts over.

// What deleting a stand says when it refuses.
const (
	MsgStandDeleteDefault = "Нельзя удалить стенд по умолчанию. Сначала назначьте другой стенд по умолчанию."
	MsgStandDeleteLast    = "Нельзя удалить последний стенд."
	MsgStandDeleteJob     = "Для стенда уже выполняется задача. Дождитесь её завершения или остановите её."
	MsgStandDeleteName    = "Введённое имя не совпадает с именем стенда."
	MsgStandDeleting      = "Нельзя оформить заказ на стенд «%s»: идёт удаление стенда."
)

// DeleteStand starts the job that deletes the stand. The admin types the
// stand's name to confirm; the default stand, the last one and one with a job
// running are refused.
func (s *Service) DeleteStand(ctx context.Context, u *models.User, id, confirmName string) (*models.StandJob, error) {
	if !u.IsAdmin() {
		return nil, ErrForbidden
	}
	st, err := s.GetStand(ctx, id)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(confirmName) != st.Name {
		return nil, &ValidationError{Message: MsgStandDeleteName}
	}
	if st.Default {
		return nil, &ValidationError{Message: MsgStandDeleteDefault}
	}
	all, err := s.store.ListStands(ctx)
	if err != nil {
		return nil, err
	}
	if len(all) <= 1 {
		return nil, &ValidationError{Message: MsgStandDeleteLast}
	}
	if st.Job != nil {
		return nil, &ValidationError{Message: MsgStandDeleteJob}
	}
	orders, err := s.store.ListRequests(ctx, store.RequestFilter{Admin: true, Stand: st.ID})
	if err != nil {
		return nil, err
	}
	j := &models.StandJob{
		ID: newID(), StandID: st.ID, Kind: models.StandJobDelete,
		FromMode: st.Mode, Status: models.StandJobRunning, CreatedBy: u.Subject,
		Total: len(orders),
	}
	if err := s.store.CreateStandJob(ctx, j); err != nil {
		if errors.Is(err, models.ErrConflict) {
			return nil, &ValidationError{Message: MsgStandDeleteJob}
		}
		return nil, err
	}
	s.logger().Info("stand deletion started", "stand", st.ID, "stand_name", st.Name, "job", j.ID, "orders", len(orders), "actor", u.Subject)
	return j, nil
}

// standDeleting reports whether a delete job is running on the stand: no new
// order may be placed on it then.
func (s *Service) standDeleting(ctx context.Context, st *models.Stand) (bool, error) {
	if st == nil || st.ID == "" {
		return false, nil
	}
	j, err := s.runningJob(ctx, st.ID)
	if err != nil {
		return false, err
	}
	return j != nil && j.Kind == models.StandJobDelete, nil
}

// refuseDeleting is the refusal of an order on a stand being deleted.
func (s *Service) refuseDeleting(ctx context.Context, st *models.Stand) error {
	deleting, err := s.standDeleting(ctx, st)
	if err != nil {
		return err
	}
	if deleting {
		return &ValidationError{Message: fmt.Sprintf(MsgStandDeleting, st.Name)}
	}
	return nil
}

// advanceDeleteJob runs one pass of a delete job: deletes up to a batch of
// the stand's orders that have nothing in flight, counts what is left, and
// once nothing is, deletes the stand.
func (s *Service) advanceDeleteJob(ctx context.Context, j *models.StandJob, st *models.Stand) error {
	orders, err := s.store.ListRequests(ctx, store.RequestFilter{Admin: true, Stand: st.ID})
	if err != nil {
		return err
	}
	failed := map[string]bool{}
	for _, f := range j.Failures {
		failed[f.OrderID] = true
	}
	// The job acts as the admin who started it: the history of each order
	// names a person, not the platform.
	actor := &models.User{Subject: j.CreatedBy, Role: models.RoleAdmin}
	remaining, waiting, budget := 0, 0, standJobBatch
	for _, r := range orders {
		remaining++
		if failed[r.ID] {
			continue
		}
		switch r.Status {
		case models.StatusDeleteRequested, models.StatusDeleteMRMerged:
			waiting++ // on its way out already
			continue
		}
		if mr, err := s.store.GetOpenMR(ctx, r.ID); err == nil && mr != nil {
			waiting++ // a change is open; deleting waits for it
			continue
		} else if err != nil && !errors.Is(err, models.ErrNotFound) {
			return err
		}
		if budget == 0 {
			continue
		}
		budget--
		if r.Status == models.StatusMRClosed {
			// Turned down: nothing in Git, nothing in a cluster, and no edge
			// out of the state. Closed out directly.
			err = s.closeOutRejected(ctx, actor, r)
		} else {
			_, err = s.Delete(ctx, actor, r.ID)
		}
		if err != nil {
			f := models.StandJobFailure{OrderID: r.ID, ServiceName: r.ServiceName, Reason: jobFailUpstream, Detail: err.Error()}
			var verr *ValidationError
			if errors.As(err, &verr) {
				f.Reason, f.Detail = jobFailRejected, verr.Message
			}
			j.Failures = append(j.Failures, f)
			failed[r.ID] = true
			s.logger().Warn("stand deletion could not delete an order", "stand", st.ID, "job", j.ID, "order_id", r.ID, "err", err)
			continue
		}
		if fresh, gerr := s.store.GetRequest(ctx, r.ID); gerr == nil && fresh.DeletedAt != nil {
			remaining--
		} else {
			waiting++
		}
	}
	j.Done = max(j.Total-remaining, 0)
	j.Waiting = waiting
	if remaining > len(failed) {
		return s.store.UpdateStandJob(ctx, j)
	}
	now := time.Now()
	j.Status, j.FinishedAt = models.StandJobDone, &now
	if remaining == 0 {
		s.removeStandStorage(ctx, st)
		if err := s.store.DeleteStand(ctx, st.ID); err != nil {
			return err
		}
		s.logger().Info("stand deleted", "stand", st.ID, "stand_name", st.Name, "job", j.ID)
	} else {
		s.logger().Info("stand kept: some orders could not be deleted", "stand", st.ID, "job", j.ID, "failed", len(failed))
	}
	return s.store.UpdateStandJob(ctx, j)
}

// closeOutRejected marks a turned-down order deleted: there is nothing of it
// anywhere but in the portal.
func (s *Service) closeOutRejected(ctx context.Context, u *models.User, r *models.Request) error {
	now := time.Now()
	r.DeletedAt = &now
	r.Status = models.StatusDeleted
	if err := s.store.UpdateRequest(ctx, r); err != nil {
		return err
	}
	s.event(ctx, r, byUser(u), "deleted", models.StatusMRClosed, models.StatusDeleted)
	s.publishStatus(r.ID, string(models.StatusDeleted))
	return nil
}

// removeStandStorage removes the group or repository the portal made for the
// stand in GitLab. Never the configured group or anything above it, never a
// path another stand still writes under, and never storage the portal did not
// make. Best effort: the stand is deleted either way, and storage left behind
// is only an empty group.
func (s *Service) removeStandStorage(ctx context.Context, st *models.Stand) {
	if !st.StorageCreated || !st.WritesGit() || st.GitPath == "" {
		return
	}
	top := s.gitops.TopGroup
	if st.GitPath == top || strings.HasPrefix(top, st.GitPath+"/") {
		return
	}
	others, err := s.store.ListStands(ctx)
	if err != nil {
		s.logger().Warn("stand storage kept: stands unreadable", "stand", st.ID, "err", err)
		return
	}
	for _, o := range others {
		if o.ID != st.ID && (o.GitPath == st.GitPath || strings.HasPrefix(o.GitPath, st.GitPath+"/")) {
			s.logger().Info("stand storage kept: another stand writes under it", "stand", st.ID, "other", o.ID)
			return
		}
	}
	if st.Layout == models.LayoutRepository {
		p, err := s.gl.GetProject(ctx, st.GitPath)
		if err == nil {
			err = s.gl.DeleteProject(ctx, p.ID)
		}
		if err != nil && !errors.Is(err, models.ErrNotFound) {
			s.logger().Warn("stand repository not removed", "stand", st.ID, "path", st.GitPath, "err", err)
			return
		}
	} else {
		g, err := s.gl.GetGroup(ctx, st.GitPath)
		if err == nil {
			err = s.gl.DeleteGroup(ctx, g.ID)
		}
		if err != nil && !errors.Is(err, models.ErrNotFound) {
			s.logger().Warn("stand group not removed", "stand", st.ID, "path", st.GitPath, "err", err)
			return
		}
	}
	s.logger().Info("stand storage removed", "stand", st.ID, "path", st.GitPath)
}
