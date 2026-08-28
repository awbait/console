package provisioning_test

import (
	"context"
	"errors"
	"strings"
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

// One team runs one service of one chart in several namespaces: dev beside
// stage, two contours of one application. The name is the service's name, and
// carrying the contour inside it (pg-dev, pg-stage) is what a team had to do
// while the uniqueness key knew only the cluster.
//
// The stack here renders the application name from the shipped default, which
// is the one that has to tell those orders apart.
func newNamespaceStack(t *testing.T) (*provisioning.Service, *gitlab.Fake, store.Store) {
	t.Helper()
	st := store.NewMemory()
	gl := gitlab.NewFake("managed-services", []string{"team-core"}, true) // auto-merge
	gitops, err := provisioning.NewGitOps("managed-services", "team-{{.Team}}",
		"{{.Team}}-{{.Chart}}-{{.Namespace}}-{{.ServiceName}}", "portal-managed", "main")
	if err != nil {
		t.Fatal(err)
	}
	prov := provisioning.New(st, gl, argocd.NewFake(gl),
		catalog.New(harbor.NewFake(), cache.NewMemory()), gitops, events.New(), "in-cluster", "main", true)
	return prov, gl, st
}

func TestSameNameInAnotherNamespace(t *testing.T) {
	ctx := context.Background()
	prov, gl, _ := newNamespaceStack(t)
	u := member("core")

	order := func(namespace string) (*models.Request, error) {
		return prov.Create(ctx, u, provisioning.CreateInput{
			ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
			Team: "core", ServiceName: "pg", Namespace: namespace, Values: validValues(),
		})
	}

	dev, err := order("dev")
	if err != nil {
		t.Fatalf("first order: %v", err)
	}
	stage, err := order("stage")
	if err != nil {
		t.Fatalf("the same name in another namespace was refused: %v", err)
	}

	// Two orders, two applications: one name would leave two application.yaml
	// files defining a single Application for Argo CD to overwrite in turn.
	if dev.ArgoCDAppName == stage.ArgoCDAppName {
		t.Fatalf("both orders are the application %q", dev.ArgoCDAppName)
	}
	// And two folders, or the second order's commit overwrites the first's
	// values.yaml and one service quietly becomes the other.
	if dev.InstancePath == stage.InstancePath {
		t.Fatalf("both orders own the folder %q", dev.InstancePath)
	}

	proj, err := gl.GetProject(ctx, "managed-services/team-core/postgres")
	if err != nil {
		t.Fatalf("repo: %v", err)
	}
	for _, r := range []*models.Request{dev, stage} {
		for _, name := range []string{"application.yaml", "values.yaml"} {
			if _, ferr := gl.GetFile(ctx, proj.ID, r.InstancePath+"/"+name, "main"); ferr != nil {
				t.Fatalf("%s of the %s order is not in Git: %v", name, r.Namespace, ferr)
			}
		}
	}
}

// The same name twice in one namespace is still one service ordered twice, and
// the refusal has to name the namespace: that is the field a person changes to
// get the two side by side.
func TestSameNameInTheSameNamespaceIsRefused(t *testing.T) {
	ctx := context.Background()
	prov, _, _ := newNamespaceStack(t)
	u := member("core")

	in := provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "pg", Namespace: "dev", DisplayName: "Постгрес дев",
		Values: validValues(),
	}
	if _, err := prov.Create(ctx, u, in); err != nil {
		t.Fatalf("first order: %v", err)
	}

	_, err := prov.Create(ctx, u, in)
	if !errors.Is(err, models.ErrConflict) {
		t.Fatalf("want conflict, got %v", err)
	}
	if !strings.Contains(err.Error(), "dev") || !strings.Contains(err.Error(), "pg") {
		t.Fatalf("the refusal names neither the namespace nor the name: %q", err)
	}
}

// An order that left the namespace empty deploys into the service's own
// namespace, so it has to collide with one that spells that namespace out.
// Comparing the stored values literally would put the two on either side of
// the key and let both through.
func TestEmptyNamespaceCollidesWithItsOwnName(t *testing.T) {
	ctx := context.Background()
	prov, _, _ := newNamespaceStack(t)
	u := member("core")

	implicit, err := prov.Create(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "pg", Values: validValues(),
	})
	if err != nil {
		t.Fatalf("first order: %v", err)
	}
	if implicit.Namespace != "pg" {
		t.Fatalf("an empty namespace should resolve to the service name, got %q", implicit.Namespace)
	}

	_, err = prov.Create(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "pg", Namespace: "pg", Values: validValues(),
	})
	if !errors.Is(err, models.ErrConflict) {
		t.Fatalf("want conflict, got %v", err)
	}
}
