package provisioning_test

import (
	"context"
	"testing"

	"console/internal/gitlab"
	"console/internal/provisioning"
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
