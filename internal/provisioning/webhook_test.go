package provisioning_test

import (
	"context"
	"testing"

	"console/internal/gitlab"
	"console/internal/provisioning"
	"console/pkg/models"
)

// Under the per-repository scope a repo created for an order is hooked right
// there, so its first merge is delivered without anyone rerunning a setup
// script. The wider scopes are covered in internal/gitlab.
func TestOrderRepoGetsWebhook(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	hook := gitlab.Hook{URL: "https://portal.local/api/v1/webhooks/gitlab", Token: "s3cret"}
	// A bare fake is a Free-tier instance with a plain token: the cascade lands
	// on per-repository hooks.
	hooks := gitlab.NewHookManager(s.gl, "managed-services", hook, gitlab.HookScopeAuto, nil)
	scope, err := hooks.Ensure(ctx)
	if err != nil {
		t.Fatalf("ensure hooks: %v", err)
	}
	if scope != gitlab.HookScopeProject {
		t.Fatalf("scope = %q, want %q", scope, gitlab.HookScopeProject)
	}
	s.prov.Hooks = hooks

	req, err := s.prov.Create(ctx, member("core"), provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "pg1", Values: validValues(),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	mrs, err := s.st.ListMRs(ctx, req.ID)
	if err != nil || len(mrs) == 0 {
		t.Fatalf("no MRs for %s: %v", req.ID, err)
	}

	_, _, projects := s.gl.Hooks()
	got, ok := projects[mrs[0].GitLabProjectID]
	if !ok {
		t.Fatalf("repo %d created for the order has no webhook", mrs[0].GitLabProjectID)
	}
	if got != hook {
		t.Fatalf("hook = %+v, want %+v", got, hook)
	}
}

// A repo the portal did not create is hooked when discovery adopts it: nothing
// else would, and under the per-repository scope its merges would otherwise go
// unnoticed until a restart swept the group.
func TestImportedRepoGetsWebhook(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	hook := gitlab.Hook{URL: "https://portal.local/api/v1/webhooks/gitlab", Token: "s3cret"}
	hooks := gitlab.NewHookManager(s.gl, "managed-services", hook, gitlab.HookScopeAuto, nil)
	if _, err := hooks.Ensure(ctx); err != nil {
		t.Fatalf("ensure hooks: %v", err)
	}
	s.prov.Hooks = hooks

	// A conforming instance created straight in Git, after the startup sweep.
	want := &models.Request{
		Team: "core", ChartProject: "platform", ChartName: "postgres", ChartVersion: "15.4.2",
		ServiceName: "pg9", Cluster: "in-cluster", Namespace: "pg9-ns",
		ArgoCDAppName: "core-postgres-pg9",
	}
	appYAML, err := s.gitops.RenderApplication(want, webURLFor("managed-services/team-core/postgres"))
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	makeRepoByID(ctx, t, s.gl, "postgres", map[string]string{
		"in-cluster/pg9/application.yaml": appYAML,
		"in-cluster/pg9/values.yaml":      "auth:\n  database: app\n",
	})
	if _, _, projects := s.gl.Hooks(); len(projects) != 0 {
		t.Fatalf("repo created outside the portal is hooked before discovery ran: %v", projects)
	}

	if err := s.prov.ImportFromGit(ctx); err != nil {
		t.Fatalf("import: %v", err)
	}

	p, err := s.gl.GetProject(ctx, "managed-services/team-core/postgres")
	if err != nil {
		t.Fatalf("get project: %v", err)
	}
	_, _, projects := s.gl.Hooks()
	if _, ok := projects[p.ID]; !ok {
		t.Fatalf("adopted repo %d has no webhook", p.ID)
	}
}
