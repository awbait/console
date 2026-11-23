package provisioning_test

import (
	"context"
	"strings"
	"testing"

	"console/internal/gitlab"
	"console/internal/provisioning"
	"console/pkg/models"
)

// A stand may point at a pre-existing repository whose default branch differs
// from the portal's global GITLAB_DEFAULT_BRANCH (e.g. "master" vs "main").
// Create, update/upgrade, drift checks, deletion and mode-change unpublish must
// all target the repository's own default branch and render it into
// application.yaml.
func TestStandRepoWithCustomDefaultBranch(t *testing.T) {
	ctx := context.Background()
	s := newStack(t) // global default branch is "main"

	st := &models.Stand{
		Name:           "legacy-edp",
		DefaultCluster: "edp-a",
		Layout:         models.LayoutRepository,
		GitPath:        "managed-services/edp-repo",
		Mode:           models.ModeGit,
	}
	if err := s.prov.CreateStand(ctx, admin(), st); err != nil {
		t.Fatalf("create stand: %v", err)
	}

	// Pre-create the stand's repository with "master" as its default branch.
	top, err := s.gl.GetGroup(ctx, "managed-services")
	if err != nil {
		t.Fatalf("get top group: %v", err)
	}
	proj, err := s.gl.CreateProject(ctx, top.ID, "edp-repo")
	if err != nil {
		t.Fatalf("create repo: %v", err)
	}
	if err := s.gl.CommitFiles(ctx, proj.ID, "master", "init master", []gitlab.FileAction{
		{Action: "create", FilePath: ".gitkeep", Content: ""},
	}); err != nil {
		t.Fatalf("seed master: %v", err)
	}

	// 1) Create an order -> branches from and targets "master".
	r, err := s.prov.Create(ctx, member("core"), newOrder("pg1", onStand(st.ID), func(in *provisioning.CreateInput) {
		in.Draft = false
		in.Version = "15.4.1"
		in.Values = validValues()
	}))
	if err != nil {
		t.Fatalf("create on master repo: %v", err)
	}
	s.mergeLatestMR(ctx, t, r.ID)
	s.tick(ctx)
	if got := mustStatus(ctx, t, s.st, r.ID); got != models.StatusGitSaved {
		t.Fatalf("status after create merge: %s", got)
	}

	// Rendered application.yaml points the values source at "master", not "main".
	appBytes, err := s.gl.GetFile(ctx, proj.ID, s.gitops.AppPath(r), "master")
	if err != nil {
		t.Fatalf("read application.yaml from master: %v", err)
	}
	if !strings.Contains(string(appBytes), "targetRevision: master") {
		t.Fatalf("application.yaml should reference master:\n%s", appBytes)
	}

	// Drift check compares against "master" and reports no drift.
	if err := s.prov.CheckDrift(ctx); err != nil {
		t.Fatalf("drift check: %v", err)
	}
	if got, _ := s.st.GetRequest(ctx, r.ID); got.Drifted {
		t.Fatalf("unexpected drift on master repo: %s", got.DriftDetail)
	}

	// 2) Upgrade chart version -> branches from and targets "master".
	if _, err := s.prov.Update(ctx, member("core"), r.ID, provisioning.UpdateInput{
		Version: "15.4.2",
		Values:  validValues(),
	}); err != nil {
		t.Fatalf("upgrade on master repo: %v", err)
	}
	s.mergeLatestMR(ctx, t, r.ID)
	s.tick(ctx)
	appBytes, err = s.gl.GetFile(ctx, proj.ID, s.gitops.AppPath(r), "master")
	if err != nil {
		t.Fatalf("read upgraded application.yaml from master: %v", err)
	}
	if !strings.Contains(string(appBytes), "targetRevision: 15.4.2") || !strings.Contains(string(appBytes), "targetRevision: master") {
		t.Fatalf("upgraded application.yaml missing new version or master branch:\n%s", appBytes)
	}

	// 3) Delete order -> lists tree on "master" and opens delete MR against "master".
	if _, err := s.prov.Delete(ctx, member("core"), r.ID); err != nil {
		t.Fatalf("delete on master repo: %v", err)
	}
	s.mergeLatestMR(ctx, t, r.ID)
	s.tick(ctx)
	if got := mustStatus(ctx, t, s.st, r.ID); got != models.StatusDeleted {
		t.Fatalf("status after delete merge: %s", got)
	}
	if files, _ := s.gl.ListTree(ctx, proj.ID, "master", s.gitops.InstanceDir(r)); len(files) != 0 {
		t.Fatalf("instance files should be removed from master, left: %v", files)
	}
}
