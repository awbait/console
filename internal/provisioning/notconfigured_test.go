package provisioning_test

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"console/internal/argocd"
	"console/internal/cache"
	"console/internal/catalog"
	"console/internal/events"
	"console/internal/gitlab"
	"console/internal/harbor"
	"console/internal/provisioning"
	"console/internal/store"
	"console/pkg/models"
)

// refusingGitLab answers one call the way a real instance answers a token that
// is missing a permission: 403, promptly, with the rest of the port intact.
type refusingGitLab struct {
	gitlab.Port
}

func (refusingGitLab) CreateProject(context.Context, int, string) (*gitlab.Project, error) {
	return nil, fmt.Errorf("gitlab: status 403: %w: {\"message\":\"403 Forbidden\"}", gitlab.ErrForbidden)
}

// A refusal is not an outage. GitLab is up and has answered - what is missing is
// a role somebody has to grant - so the order must not come back as ErrUpstream,
// which the API answers with 502 and the portal reports as a platform failure.
func TestRefusedGitLabIsNotConfigured(t *testing.T) {
	ctx := context.Background()
	st := store.NewMemory()
	gl := gitlab.NewFake("managed-services", []string{"team-core"}, false)
	gitops, err := provisioning.NewGitOps("managed-services", "team-{{.Team}}",
		"{{.Team}}-{{.Chart}}-{{.ServiceName}}", "portal-managed", "main")
	if err != nil {
		t.Fatal(err)
	}
	prov := provisioning.New(st, refusingGitLab{gl}, argocd.NewFake(gl),
		catalog.New(harbor.NewFake(), cache.NewMemory()), gitops, events.New(), "in-cluster", "main", false)

	u := member("core")
	req, err := prov.Create(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "pg1", Values: validValues(), Draft: true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	_, err = prov.Submit(ctx, u, req.ID)
	if !errors.Is(err, models.ErrNotConfigured) {
		t.Fatalf("want ErrNotConfigured, got %v", err)
	}
	if errors.Is(err, models.ErrUpstream) {
		t.Fatalf("a refusal must not read as an outage: %v", err)
	}

	// The order stays a draft, so the person can send it again once the rights
	// are granted, without filling the form in a second time.
	got, err := st.GetRequest(ctx, req.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Status != models.StatusDraft {
		t.Fatalf("status = %s, want DRAFT", got.Status)
	}
}
