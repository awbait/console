package checks

import (
	"context"
	"testing"

	"console/internal/argocd"
	"console/internal/gitlab"
	"console/pkg/models"
)

// The stand checks' side of the fakes: a repository lookup and an
// application lookup.
func (f *fakeGitLab) GetProject(context.Context, string) (*gitlab.Project, error) {
	return f.project, f.projectErr
}

func (f *fakeArgo) GetApplication(_ context.Context, name string) (*argocd.Application, error) {
	if f.apps[name] {
		return &argocd.Application{Name: name}, nil
	}
	return nil, models.ErrNotFound
}

func standOrder(cluster, app string) *models.Request {
	return &models.Request{Cluster: cluster, ArgoCDAppName: app, Status: models.StatusHealthy}
}

func byID(results []CheckResult) map[string]CheckResult {
	out := map[string]CheckResult{}
	for _, r := range results {
		out[r.ID] = r
	}
	return out
}

// A stand laid out as one repository: the repository is looked up; while it
// is not there yet the group it will be made in has to be, and that is a
// warning, not a failure.
func TestStandGitRepositoryLayout(t *testing.T) {
	ctx := context.Background()
	st := &models.Stand{Name: "prod", DefaultCluster: "prod-a", Layout: models.LayoutRepository, GitPath: "ops/prod-gitops"}

	got := byID(Stand(ctx, &fakeGitLab{project: &gitlab.Project{ID: 7}}, nil, st, nil, "managed"))
	if r := got[IDStandGit]; r.Verdict != VerdictOK || r.Reason != reasonRepoFound || r.Facts["project_id"] != "7" {
		t.Fatalf("repository found: %+v", r)
	}
	got = byID(Stand(ctx, &fakeGitLab{projectErr: models.ErrNotFound, account: &gitlab.Account{ID: 1}, access: gitlab.AccessMaintainer}, nil, st, nil, "managed"))
	if r := got[IDStandGit]; r.Verdict != VerdictWarn || r.Reason != reasonRepoMissing {
		t.Fatalf("repository missing with its group there: %+v", r)
	}
	got = byID(Stand(ctx, &fakeGitLab{projectErr: models.ErrNotFound, groupErr: models.ErrNotFound}, nil, st, nil, "managed"))
	if r := got[IDStandGit]; r.Verdict != VerdictFail || r.Reason != reasonGroupMissing {
		t.Fatalf("repository and its group missing: %+v", r)
	}
	// Nothing to read through: said so, not failed.
	got = byID(Stand(ctx, nil, nil, st, nil, "managed"))
	for _, id := range []string{IDStandGit, IDStandCluster, IDStandArgo} {
		if got[id].Verdict != VerdictUnknown {
			t.Errorf("%s without an upstream: %+v", id, got[id])
		}
	}
}

// The group layout asks the same question the configured group is asked.
func TestStandGitGroupLayout(t *testing.T) {
	ctx := context.Background()
	st := &models.Stand{Name: "stage", DefaultCluster: "stage", Layout: models.LayoutGroup, GitPath: "managed-services/stage"}
	got := byID(Stand(ctx, &fakeGitLab{account: &gitlab.Account{ID: 1}, access: gitlab.AccessOwner}, nil, st, nil, "managed"))
	if r := got[IDStandGit]; r.Verdict != VerdictOK || r.Reason != reasonRoleEnough {
		t.Fatalf("owner on the stand's group: %+v", r)
	}
	got = byID(Stand(ctx, &fakeGitLab{account: &gitlab.Account{ID: 1}, access: gitlab.AccessMaintainer}, nil, st, nil, "managed"))
	if r := got[IDStandGit]; r.Verdict != VerdictFail || r.Reason != reasonNeedsOwner {
		t.Fatalf("maintainer where subgroups are created: %+v", r)
	}
	// A stand with no path yet (made before paths existed) has nothing to look
	// up, and the reason says that rather than blaming the upstream.
	if r := byID(Stand(ctx, &fakeGitLab{}, nil, &models.Stand{Name: "x"}, nil, "managed"))[IDStandGit]; r.Verdict != VerdictFail || r.Reason != reasonPathEmpty {
		t.Fatalf("a stand without a path: %+v", r)
	}
}

// What the stand's mode leaves to check: a Git-only stand is checked in
// GitLab and skipped in Argo CD, a console-only stand is skipped everywhere,
// each with a reason naming the mode rather than a missing upstream.
func TestStandChecksByMode(t *testing.T) {
	ctx := context.Background()
	gl := &fakeGitLab{account: &gitlab.Account{ID: 1}, access: gitlab.AccessOwner}
	orders := []*models.Request{standOrder("stage", "a")}

	git := &models.Stand{Name: "archive", DefaultCluster: "stage", Layout: models.LayoutGroup, GitPath: "managed-services/archive", Mode: models.ModeGit}
	got := byID(Stand(ctx, gl, &fakeArgo{}, git, orders, "managed"))
	if r := got[IDStandGit]; r.Verdict != VerdictOK || r.Reason != reasonRoleEnough {
		t.Fatalf("git-only stand is still checked in GitLab: %+v", r)
	}
	for _, id := range []string{IDStandCluster, IDStandArgo} {
		if r := got[id]; r.Verdict != VerdictSkip || r.Reason != reasonModeGit {
			t.Fatalf("%s on a git-only stand: %+v", id, r)
		}
	}

	console := &models.Stand{Name: "sandbox", DefaultCluster: "stage", Layout: models.LayoutGroup, GitPath: "managed-services/sandbox", Mode: models.ModeConsole}
	got = byID(Stand(ctx, gl, &fakeArgo{}, console, orders, "managed"))
	for _, id := range []string{IDStandGit, IDStandCluster, IDStandArgo} {
		if r := got[id]; r.Verdict != VerdictSkip || r.Reason != reasonModeConsole {
			t.Fatalf("%s on a console-only stand: %+v", id, r)
		}
	}
}

// Every cluster the stand's orders go to, and its default, has to be
// registered; the missing ones are named.
func TestStandClusters(t *testing.T) {
	ctx := context.Background()
	st := &models.Stand{Name: "prod", DefaultCluster: "prod-a", GitPath: "x"}
	orders := []*models.Request{standOrder("prod-a", "a"), standOrder("prod-b", "b"), {Cluster: "draft-c", Status: models.StatusDraft}}
	argo := &fakeArgo{clusters: []argocd.Cluster{{Name: "prod-a"}, {Name: "prod-b"}}}
	got := byID(Stand(ctx, nil, argo, st, orders, "managed"))
	if r := got[IDStandCluster]; r.Verdict != VerdictOK || r.Facts["clusters"] != "prod-a, prod-b" {
		t.Fatalf("all registered (drafts not counted): %+v", r)
	}
	argo.clusters = []argocd.Cluster{{Name: "prod-a"}}
	got = byID(Stand(ctx, nil, argo, st, orders, "managed"))
	if r := got[IDStandCluster]; r.Verdict != VerdictFail || r.Reason != reasonClusterMissing || r.Facts["missing"] != "prod-b" {
		t.Fatalf("one missing: %+v", r)
	}
}

// Argo CD is asked for the stand's applications: none found is a stand that
// is not wired, some found is a stand half there, and no live orders is
// nothing to ask about.
func TestStandApplications(t *testing.T) {
	ctx := context.Background()
	st := &models.Stand{Name: "prod", DefaultCluster: "prod-a", GitPath: "x"}
	argo := &fakeArgo{apps: map[string]bool{"a": true}}
	orders := []*models.Request{standOrder("prod-a", "a"), standOrder("prod-a", "b")}
	if r := byID(Stand(ctx, nil, argo, st, orders, "managed"))[IDStandArgo]; r.Verdict != VerdictWarn || r.Reason != reasonAppsPartial || r.Facts["found"] != "1" || r.Facts["looked"] != "2" {
		t.Fatalf("half there: %+v", r)
	}
	argo.apps["b"] = true
	if r := byID(Stand(ctx, nil, argo, st, orders, "managed"))[IDStandArgo]; r.Verdict != VerdictOK || r.Reason != reasonAppsFound {
		t.Fatalf("all there: %+v", r)
	}
	argo.apps = map[string]bool{}
	if r := byID(Stand(ctx, nil, argo, st, orders, "managed"))[IDStandArgo]; r.Verdict != VerdictFail || r.Reason != reasonAppsMissing {
		t.Fatalf("none there: %+v", r)
	}
	if r := byID(Stand(ctx, nil, argo, st, nil, "managed"))[IDStandArgo]; r.Verdict != VerdictSkip || r.Reason != reasonNoOrders {
		t.Fatalf("nothing to ask: %+v", r)
	}
}

// The project a stand's applications go to is checked like the platform's:
// missing, readable but not syncable, and fine; the project is named in the
// facts, so a stand in a project of its own says which one.
func TestStandProject(t *testing.T) {
	ctx := context.Background()
	st := &models.Stand{Name: "edp", DefaultCluster: "edp-a", GitPath: "x"}
	cases := []struct {
		name    string
		argo    *fakeArgo
		verdict Verdict
		reason  string
	}{
		{"missing", &fakeArgo{}, VerdictFail, reasonProjectMissing},
		{"read only", &fakeArgo{projectExists: true, can: map[string]bool{"get": true}}, VerdictWarn, reasonCannotSync},
		{"no read", &fakeArgo{projectExists: true}, VerdictFail, reasonCannotRead},
		{"fine", &fakeArgo{projectExists: true, can: map[string]bool{"get": true, "sync": true}}, VerdictOK, reasonMayReadAndSync},
	}
	for _, c := range cases {
		r := byID(Stand(ctx, nil, c.argo, st, nil, "edp-apps"))[IDStandProject]
		if r.Verdict != c.verdict || r.Reason != c.reason || r.Facts["project"] != "edp-apps" {
			t.Errorf("%s: %+v", c.name, r)
		}
	}
	git := &models.Stand{Name: "archive", GitPath: "x", Mode: models.ModeGit}
	if r := byID(Stand(ctx, nil, &fakeArgo{}, git, nil, "edp-apps"))[IDStandProject]; r.Verdict != VerdictSkip {
		t.Errorf("git-only stand: %+v", r)
	}
}
