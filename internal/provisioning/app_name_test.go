package provisioning_test

import (
	"context"
	"errors"
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
