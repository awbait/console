package provisioning_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"text/template"

	"console/internal/provisioning"
	"console/pkg/models"
)

// An order is unique within its stand, so the stand is part of the name its
// application gets. The default stand adds nothing: its orders keep the names
// they had before stands existed.
func TestAppNameCarriesTheStand(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	// The first stand created is the default one.
	main := mustStand(ctx, t, s, "main", "in-cluster")
	dev := mustStand(ctx, t, s, "dev", "in-cluster")
	if got, err := s.prov.GetStand(ctx, main.ID); err != nil || !got.Default {
		t.Fatalf("the first stand is not the default one: %+v %v", got, err)
	}

	onDefault, err := s.prov.Create(ctx, member("core"), newOrder("pg1", onStand(main.ID)))
	if err != nil {
		t.Fatalf("create on the default stand: %v", err)
	}
	onDev, err := s.prov.Create(ctx, member("core"), newOrder("pg1", onStand(dev.ID)))
	if err != nil {
		t.Fatalf("create on dev: %v", err)
	}
	if onDefault.ArgoCDAppName != "core-postgres-pg1" {
		t.Errorf("default stand: got %q", onDefault.ArgoCDAppName)
	}
	if onDev.ArgoCDAppName != "core-postgres-pg1-dev" {
		t.Errorf("dev stand: got %q", onDev.ArgoCDAppName)
	}
}

// withDefaultAppName switches the stack to the shipped template. The shared
// stack uses a shorter one so older lifecycle tests stay focused on their own
// behaviour.
func withDefaultAppName(s *stack) {
	s.gitops.AppNameTmpl = template.Must(template.New("appname").Parse("{{.Team}}-{{.Chart}}-{{.Namespace}}-{{.ServiceName}}{{if .Cluster}}-{{.Cluster}}{{end}}{{if .Stand}}-{{.Stand}}{{end}}"))
}

// One stand may span several clusters. Two orders that differ only by cluster
// get their own Git paths and their own Applications all the way through the
// create and merge flow.
func TestAppNameCarriesTheCluster(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	withDefaultAppName(s)
	main := mustStand(ctx, t, s, "main", "dev")

	order := func(cluster string) *models.Request {
		t.Helper()
		in := newOrder("pg1", onStand(main.ID), inCluster(cluster))
		in.Draft = false
		in.Values = validValues()
		r, err := s.prov.Create(ctx, member("core"), in)
		if err != nil {
			t.Fatalf("create on %s: %v", cluster, err)
		}
		s.mergeLatestMR(ctx, t, r.ID)
		return r
	}
	dev := order("dev")
	stage := order("stage")

	if dev.ArgoCDAppName != "core-postgres-pg1-pg1-dev" {
		t.Errorf("dev application: got %q", dev.ArgoCDAppName)
	}
	if stage.ArgoCDAppName != "core-postgres-pg1-pg1-stage" {
		t.Errorf("stage application: got %q", stage.ArgoCDAppName)
	}
	if dev.ArgoCDAppName == stage.ArgoCDAppName || dev.InstancePath == stage.InstancePath {
		t.Fatalf("orders share an application or a path: %q, %q", dev.ArgoCDAppName, dev.InstancePath)
	}

	s.tick(ctx)
	for _, r := range []*models.Request{dev, stage} {
		app, err := s.argo.GetApplication(ctx, r.ArgoCDAppName)
		if err != nil {
			t.Fatalf("application for %s: %v", r.Cluster, err)
		}
		if app.Cluster != r.Cluster {
			t.Errorf("application %q points at %q, want %q", app.Name, app.Cluster, r.Cluster)
		}
	}
}

// A draft has nothing in Git yet, so moving it to another cluster also moves
// its future Application name.
func TestDraftAppNameFollowsTheCluster(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	withDefaultAppName(s)
	main := mustStand(ctx, t, s, "main", "dev")

	r, err := s.prov.Create(ctx, member("core"), newOrder("pg1", onStand(main.ID), inCluster("dev")))
	if err != nil {
		t.Fatalf("create draft: %v", err)
	}
	moved, err := s.prov.Update(ctx, member("core"), r.ID, provisioning.UpdateInput{Cluster: "stage", Values: validValues()})
	if err != nil {
		t.Fatalf("move draft: %v", err)
	}
	if moved.ArgoCDAppName != "core-postgres-pg1-pg1-stage" {
		t.Fatalf("application name did not follow the cluster: %q", moved.ArgoCDAppName)
	}
}

func TestExistingAppNameSurvivesTemplateChange(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	in := newOrder("pg1")
	in.Draft = false
	in.Values = validValues()
	r, err := s.prov.Create(ctx, member("core"), in)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	s.mergeLatestMR(ctx, t, r.ID)
	s.tick(ctx)
	s.tick(ctx)

	// Changing the default must not rename an Application already in Git.
	withDefaultAppName(s)
	updated, err := s.prov.Update(ctx, member("core"), r.ID, provisioning.UpdateInput{
		Values: map[string]any{"auth": map[string]any{"database": "updated"}},
	})
	if err != nil {
		t.Fatalf("update after template change: %v", err)
	}
	s.mergeLatestMR(ctx, t, r.ID)
	s.tick(ctx)
	stored, err := s.st.GetRequest(ctx, r.ID)
	if err != nil {
		t.Fatalf("read updated order: %v", err)
	}
	if updated.ArgoCDAppName != r.ArgoCDAppName || stored.ArgoCDAppName != r.ArgoCDAppName || stored.InstancePath != r.InstancePath {
		t.Fatalf("existing identity changed: before %+v, after %+v", r, stored)
	}
	project, err := s.gl.GetProject(ctx, "managed-services/team-core/postgres")
	if err != nil {
		t.Fatalf("get project: %v", err)
	}
	manifest, err := s.gl.GetFile(ctx, project.ID, stored.InstancePath+"/application.yaml", "main")
	if err != nil || !strings.Contains(string(manifest), "name: "+r.ArgoCDAppName+"\n") {
		t.Fatalf("updated manifest did not keep the existing Application: %s, %v", manifest, err)
	}
}

// withoutStand switches the stack to an app-name template that leaves the
// stand out, the way a portal configured before stands may still run.
func withoutStand(s *stack) {
	s.gitops.AppNameTmpl = template.Must(template.New("appname").Parse("{{.Team}}-{{.Chart}}-{{.ServiceName}}"))
}

// Two stands whose Argo CD reads Applications from one namespace cannot both
// have an application of one name: two app-of-apps repos would define it and
// undo each other. The portal refuses the second order instead.
func TestOrderRefusedWhenAnotherStandHoldsTheAppName(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	withoutStand(s)
	tech := mustStand(ctx, t, s, "tech", "in-cluster")
	test := mustStand(ctx, t, s, "test", "in-cluster")

	if _, err := s.prov.Create(ctx, member("core"), newOrder("clickstack", onStand(tech.ID))); err != nil {
		t.Fatalf("first order: %v", err)
	}
	_, err := s.prov.Create(ctx, member("core"), newOrder("clickstack", onStand(test.ID)))
	if !errors.Is(err, models.ErrConflict) {
		t.Fatalf("an order sharing another stand's application went through: %v", err)
	}
}

// A custom template without the cluster must not silently join two orders of
// one stand in Argo CD. The database allows them because their clusters differ,
// so the application-name check is the last refusal before Git.
func TestOrderRefusedWhenSameStandHoldsTheAppName(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	withoutStand(s)
	main := mustStand(ctx, t, s, "main", "dev")

	if _, err := s.prov.Create(ctx, member("core"), newOrder("clickstack", onStand(main.ID), inCluster("dev"))); err != nil {
		t.Fatalf("first order: %v", err)
	}
	_, err := s.prov.Create(ctx, member("core"), newOrder("clickstack", onStand(main.ID), inCluster("stage")))
	if !errors.Is(err, models.ErrConflict) {
		t.Fatalf("an order sharing an application within one stand went through: %v", err)
	}
}

// A stand whose Argo CD reads Applications from a namespace of its own has
// the name to itself.
func TestStandsInSeparateArgoNamespacesShareNames(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	withoutStand(s)
	tech := mustStand(ctx, t, s, "tech", "in-cluster")
	test := &models.Stand{Name: "test", DefaultCluster: "in-cluster", GitPath: "managed-services", ArgoNamespace: "argocd-test"}
	if err := s.prov.CreateStand(ctx, admin(), test); err != nil {
		t.Fatalf("create stand: %v", err)
	}

	if _, err := s.prov.Create(ctx, member("core"), newOrder("clickstack", onStand(tech.ID))); err != nil {
		t.Fatalf("first order: %v", err)
	}
	if _, err := s.prov.Create(ctx, member("core"), newOrder("clickstack", onStand(test.ID))); err != nil {
		t.Fatalf("an order in another Argo CD namespace was refused: %v", err)
	}
}

func TestStandKey(t *testing.T) {
	cases := []struct {
		name  string
		stand *models.Stand
		want  string
	}{
		{"no stand", nil, ""},
		{"the default stand", &models.Stand{Name: "prod", Default: true}, ""},
		{"a plain name", &models.Stand{Name: "dev"}, "dev"},
		{"spaces and capitals", &models.Stand{Name: "Test Env"}, "test-env"},
		// A name with nothing Kubernetes allows still gives a name. Two such
		// stands sharing an Argo CD namespace are what the refusal above catches.
		{"cyrillic", &models.Stand{Name: "Тест"}, "stand"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := provisioning.StandKey(tc.stand); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}
