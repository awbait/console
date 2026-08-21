package provisioning_test

import (
	"context"
	"errors"
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

// newTeamlessStack builds the flow around a GitLab that knows the GitOps group
// and nothing below it: a team ordering for the first time, before anybody
// created its subgroup.
func newTeamlessStack(t *testing.T, create bool) (*provisioning.Service, *gitlab.Fake) {
	t.Helper()
	gl := gitlab.NewFake("managed-services", nil, false)
	gitops, err := provisioning.NewGitOps("managed-services", "team-{{.Team}}",
		"{{.Team}}-{{.Chart}}-{{.ServiceName}}", "portal-managed", "main")
	if err != nil {
		t.Fatal(err)
	}
	prov := provisioning.New(store.NewMemory(), gl, argocd.NewFake(gl),
		catalog.New(harbor.NewFake(), cache.NewMemory()), gitops, events.New(), "in-cluster", "main", false)
	prov.CreateTeamSubgroup = create
	return prov, gl
}

func order(ctx context.Context, t *testing.T, prov *provisioning.Service, name string) error {
	t.Helper()
	_, err := prov.Create(ctx, member("core"), provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: name, Values: validValues(),
	})
	return err
}

func TestFirstOrderCreatesTeamSubgroup(t *testing.T) {
	ctx := context.Background()
	prov, gl := newTeamlessStack(t, true)

	if err := order(ctx, t, prov, "pg1"); err != nil {
		t.Fatalf("order: %v", err)
	}
	if _, err := gl.GetGroup(ctx, "managed-services/team-core"); err != nil {
		t.Fatalf("subgroup not created: %v", err)
	}
	// The repository still lands inside it, which is the whole point: the order
	// went all the way through on a GitLab that knew nothing about this team.
	if _, err := gl.GetProject(ctx, "managed-services/team-core/postgres"); err != nil {
		t.Fatalf("repo not created: %v", err)
	}
}

func TestSecondOrderReusesTheSubgroup(t *testing.T) {
	ctx := context.Background()
	prov, gl := newTeamlessStack(t, true)

	if err := order(ctx, t, prov, "pg1"); err != nil {
		t.Fatalf("first order: %v", err)
	}
	before, err := gl.GetGroup(ctx, "managed-services/team-core")
	if err != nil {
		t.Fatalf("subgroup: %v", err)
	}
	if err := order(ctx, t, prov, "pg2"); err != nil {
		t.Fatalf("second order: %v", err)
	}
	after, err := gl.GetGroup(ctx, "managed-services/team-core")
	if err != nil {
		t.Fatalf("subgroup: %v", err)
	}
	if before.ID != after.ID {
		t.Fatalf("subgroup recreated: %d -> %d", before.ID, after.ID)
	}
}

func TestSubgroupCreationCanBeTurnedOff(t *testing.T) {
	ctx := context.Background()
	prov, gl := newTeamlessStack(t, false)

	err := order(ctx, t, prov, "pg1")
	if !errors.Is(err, models.ErrNotConfigured) {
		t.Fatalf("want ErrNotConfigured, got %v", err)
	}
	// Not an outage: GitLab answered every call it was given.
	if errors.Is(err, models.ErrUpstream) {
		t.Fatalf("must not read as an outage: %v", err)
	}
	if _, gerr := gl.GetGroup(ctx, "managed-services/team-core"); !errors.Is(gerr, models.ErrNotFound) {
		t.Fatal("subgroup created while creation is off")
	}
}

func TestMissingGitopsGroupIsNotCreated(t *testing.T) {
	ctx := context.Background()
	// A GitLab without the top-level group at all: that one is the portal's own
	// configuration, and inventing it would hide a typo in GITLAB_GITOPS_GROUP.
	gl := gitlab.NewFake("other-group", nil, false)
	gitops, err := provisioning.NewGitOps("managed-services", "team-{{.Team}}",
		"{{.Team}}-{{.Chart}}-{{.ServiceName}}", "portal-managed", "main")
	if err != nil {
		t.Fatal(err)
	}
	prov := provisioning.New(store.NewMemory(), gl, argocd.NewFake(gl),
		catalog.New(harbor.NewFake(), cache.NewMemory()), gitops, events.New(), "in-cluster", "main", false)
	prov.CreateTeamSubgroup = true

	if oerr := order(ctx, t, prov, "pg1"); !errors.Is(oerr, models.ErrNotConfigured) {
		t.Fatalf("want ErrNotConfigured, got %v", oerr)
	}
	if _, gerr := gl.GetGroup(ctx, "managed-services"); !errors.Is(gerr, models.ErrNotFound) {
		t.Fatal("top-level group created")
	}
}
