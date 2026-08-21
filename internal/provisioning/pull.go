package provisioning

import (
	"context"
	"errors"

	"console/pkg/models"
)

// PullFromGit adopts the order's current Git state into the portal: it reads the
// committed values.yaml + chart version and writes them onto the order record, so
// the portal reflects a change made directly in Git. GitOps-correct - Git is the
// source of truth, this only syncs the portal's copy to it; it does NOT open an
// MR or touch Git. Clears the drift flag and records a "git_pulled" event.
func (s *Service) PullFromGit(ctx context.Context, u *models.User, id string) (*models.Request, error) {
	r, err := s.store.GetRequest(ctx, id)
	if err != nil {
		return nil, err
	}
	if !canEdit(u, r.Team) {
		return nil, ErrForbidden
	}
	if r.DeletedAt != nil {
		return nil, models.ErrNotFound
	}

	proj, err := s.gl.GetProject(ctx, s.gitops.RepoPath(r.Team, r.ChartName))
	if err != nil {
		return nil, gitopsErr("resolve repo", err)
	}
	branch := proj.DefaultBranch
	if branch == "" {
		branch = s.defaultBranch
	}

	vb, err := s.gl.GetFile(ctx, proj.ID, s.gitops.ValuesPath(r.Cluster, r.ServiceName), branch)
	if errors.Is(err, models.ErrNotFound) {
		return nil, &ValidationError{Message: "в Git нет манифестов этого сервиса, он удалён вне портала. Нечего подтягивать, используйте «Удалить»"}
	}
	if err != nil {
		return nil, gitopsErr("read values.yaml", err)
	}
	ab, err := s.gl.GetFile(ctx, proj.ID, s.gitops.AppPath(r.Cluster, r.ServiceName), branch)
	if errors.Is(err, models.ErrNotFound) {
		return nil, &ValidationError{Message: "в Git нет манифестов этого сервиса, он удалён вне портала. Нечего подтягивать, используйте «Удалить»"}
	}
	if err != nil {
		return nil, gitopsErr("read application.yaml", err)
	}

	changed := false
	if !yamlEqual(vb, []byte(r.ValuesYAML)) {
		r.ValuesYAML = string(vb)
		changed = true
	}
	if v := chartVersionFromApp(ab); v != "" && v != r.ChartVersion {
		r.ChartVersion = v
		changed = true
	}
	if changed {
		if err := s.store.UpdateRequest(ctx, r); err != nil {
			return nil, err
		}
		s.event(ctx, r, byUser(u), "git_pulled", "", "")
	}
	// We are now in sync with Git either way - clear any drift flag.
	_ = s.store.SetDrift(ctx, r.ID, false, "")
	r.Drifted, r.DriftDetail = false, ""
	s.publishStatus(r.ID, string(r.Status))
	return r, nil
}
