package provisioning_test

import (
	"context"
	"regexp"
	"strings"
	"testing"
	"text/template"

	"gopkg.in/yaml.v3"

	"console/pkg/models"
)

func TestAppNameHelmLength(t *testing.T) {
	g := newGitOps(t)
	g.AppNameTmpl = template.Must(template.New("appname").Parse("{{.ServiceName}}"))
	valid := regexp.MustCompile(`^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`)
	for _, size := range []int{1, 52, 53, 54, 253} {
		name := strings.Repeat("a", size)
		got := g.AppName("", "", "", name, "", "")
		if len(got) > 53 || !valid.MatchString(got) {
			t.Fatalf("invalid Helm name for %d characters: %q", size, got)
		}
		if size <= 53 && got != name {
			t.Fatalf("short name changed: %q -> %q", name, got)
		}
		if again := g.AppName("", "", "", name, "", ""); again != got {
			t.Fatalf("name is not deterministic: %q / %q", got, again)
		}
	}

	// Differences after the readable prefix must survive shortening.
	base := strings.Repeat("a", 60)
	first := g.AppName("", "", "", base+"-dev", "", "")
	second := g.AppName("", "", "", base+"-stage", "", "")
	if first == second || !strings.HasPrefix(first, base[:36]) {
		t.Fatalf("long names lost their identity or readable prefix: %q / %q", first, second)
	}
	boundary := strings.Repeat("a", 35) + "-" + strings.Repeat("b", 30)
	if got := g.AppName("", "", "", boundary, "", ""); strings.Contains(got, "--") || !valid.MatchString(got) {
		t.Fatalf("invalid prefix boundary: %q", got)
	}
}

func TestStoredLongAppNameIsNotRenamed(t *testing.T) {
	g := newGitOps(t)
	r := instanceOf("dev", "db")
	r.ArgoCDAppName = strings.Repeat("a", 70)
	manifest, err := g.RenderApplication(r, "https://git.example.com/team/postgres", "registry.example.com")
	if err != nil {
		t.Fatal(err)
	}
	var app struct {
		Metadata struct {
			Name string `yaml:"name"`
		} `yaml:"metadata"`
	}
	if err := yaml.Unmarshal([]byte(manifest), &app); err != nil {
		t.Fatal(err)
	}
	if app.Metadata.Name != r.ArgoCDAppName || strings.Contains(manifest, "releaseName:") {
		t.Fatal("rendering changed an existing Application or Helm release identity")
	}
}

func TestLongAppNamesAcrossClusters(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	withDefaultAppName(s)
	stand := mustStand(ctx, t, s, "main", "dev")
	var orders []*models.Request
	for _, cluster := range []string{"dev", "stage"} {
		in := newOrder(strings.Repeat("s", 40), onStand(stand.ID), inCluster(cluster))
		in.Draft = false
		in.Values = validValues()
		r, err := s.prov.Create(ctx, member("core"), in)
		if err != nil {
			t.Fatalf("create on %s: %v", cluster, err)
		}
		if len(r.ArgoCDAppName) > 53 {
			t.Fatalf("Application name exceeds Helm limit: %q", r.ArgoCDAppName)
		}
		s.mergeLatestMR(ctx, t, r.ID)
		orders = append(orders, r)
	}
	if orders[0].ArgoCDAppName == orders[1].ArgoCDAppName {
		t.Fatal("long names in different clusters collide")
	}
	s.tick(ctx)
	for _, r := range orders {
		app, err := s.argo.GetApplication(ctx, r.ArgoCDAppName)
		if err != nil {
			t.Fatalf("application for %s: %v", r.Cluster, err)
		}
		if app.Cluster != r.Cluster {
			t.Fatalf("application points at %q, want %q", app.Cluster, r.Cluster)
		}
	}
}
