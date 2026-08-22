package provisioning_test

import (
	"slices"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"

	"console/internal/provisioning"
	"console/pkg/models"
)

func newGitOps(t *testing.T) *provisioning.GitOps {
	t.Helper()
	g, err := provisioning.NewGitOps("managed-services", "team-{{.Team}}",
		"{{.Team}}-{{.Chart}}-{{.ServiceName}}", "portal-managed", "main")
	if err != nil {
		t.Fatal(err)
	}
	return g
}

// instanceOf is an order carrying just what the repo layout is built from.
func instanceOf(cluster, service string) *models.Request {
	return &models.Request{Team: "core", ChartName: "postgres", ServiceName: service,
		Cluster: cluster, Namespace: "apps"}
}

// TestInstancePathsIncludeCluster locks in the repo layout: {cluster}/{service}/...
func TestInstancePathsIncludeCluster(t *testing.T) {
	g := newGitOps(t)
	prod := instanceOf("prod", "pg1")

	if got, want := g.NewInstancePath(prod), "prod/pg1"; got != want {
		t.Errorf("NewInstancePath = %q, want %q", got, want)
	}
	if got, want := g.AppPath(prod), "prod/pg1/application.yaml"; got != want {
		t.Errorf("AppPath = %q, want %q", got, want)
	}
	if got, want := g.ValuesPath(prod), "prod/pg1/values.yaml"; got != want {
		t.Errorf("ValuesPath = %q, want %q", got, want)
	}

	// Same service in different clusters lives in separate folders.
	if g.NewInstancePath(instanceOf("dev", "pg1")) == g.NewInstancePath(prod) {
		t.Error("instances in different clusters must not collide")
	}

	// Empty cluster falls back to the flat legacy layout.
	if got, want := g.AppPath(instanceOf("", "pg1")), "pg1/application.yaml"; got != want {
		t.Errorf("AppPath(empty cluster) = %q, want %q", got, want)
	}
}

// The folder is rendered once and then carried. A template is a setting, and a
// setting that moved every existing order's folder would leave the portal
// writing to, reading drift from and deleting a folder its files are not in.
func TestInstanceTemplate(t *testing.T) {
	g := newGitOps(t)
	r := instanceOf("in-cluster", "pg1")

	if err := g.SetInstanceTemplate("{{.Namespace}}-{{.ServiceName}}"); err != nil {
		t.Fatalf("SetInstanceTemplate: %v", err)
	}
	if got, want := g.NewInstancePath(r), "in-cluster/apps-pg1"; got != want {
		t.Fatalf("NewInstancePath = %q, want %q", got, want)
	}

	// An order created earlier keeps its own folder, whatever the template says.
	r.InstancePath = "in-cluster/pg1"
	if got, want := g.ValuesPath(r), "in-cluster/pg1/values.yaml"; got != want {
		t.Fatalf("ValuesPath = %q, want %q", got, want)
	}

	// A template that renders to nothing would drop the manifests straight into
	// the cluster folder, where the next order of this chart overwrites them.
	if err := g.SetInstanceTemplate("{{.Team}}"); err != nil {
		t.Fatalf("SetInstanceTemplate: %v", err)
	}
	empty := instanceOf("in-cluster", "pg1")
	empty.Team = ""
	if got, want := g.NewInstancePath(empty), "in-cluster/pg1"; got != want {
		t.Fatalf("empty render = %q, want the service name %q", got, want)
	}

	if err := g.SetInstanceTemplate("{{.Namespace"); err == nil {
		t.Fatal("a broken template must be refused at startup, not at the first order")
	}
	if err := g.SetInstanceTemplate(""); err != nil || g.InstanceTmpl != nil {
		t.Fatalf("empty template must restore the default: err=%v", err)
	}
}

// The Application lands in the namespace Argo CD runs in. Argo CD reads
// Applications from its own namespace only, so a manifest committed anywhere
// else is applied by the app-of-apps and then read by nobody: the order reaches
// Git and the service never comes up, with nothing to see anywhere.
func TestRenderApplicationNamespace(t *testing.T) {
	r := &models.Request{
		Team: "core", ChartName: "postgres", ServiceName: "pg1", ChartVersion: "3.1.0",
		Cluster: "in-cluster", Namespace: "apps", ArgoCDAppName: "core-postgres-pg1",
	}

	// Unset: the upstream default, which is what every install had before the
	// namespace was configurable.
	g := newGitOps(t)
	out, err := g.RenderApplication(r, "https://gitlab/x.git")
	if err != nil {
		t.Fatalf("RenderApplication: %v", err)
	}
	if ns := metadataNamespace(t, out); ns != "argocd" {
		t.Fatalf("metadata.namespace = %q, want argocd", ns)
	}

	g.AppNamespace = "tech-argocd"
	out, err = g.RenderApplication(r, "https://gitlab/x.git")
	if err != nil {
		t.Fatalf("RenderApplication: %v", err)
	}
	if ns := metadataNamespace(t, out); ns != "tech-argocd" {
		t.Fatalf("metadata.namespace = %q, want tech-argocd", ns)
	}
	// The service's own namespace is a different thing and must not follow it.
	if !strings.Contains(out, "namespace: apps") {
		t.Fatalf("destination namespace lost:\n%s", out)
	}
}

// Deleting an order has to delete the service, not just the record of it. The
// app-of-apps prunes the Application CR when this file disappears, and a prune
// of an Application without the resources finalizer is non-cascading: Argo CD
// drops the CR and leaves every deployed resource running in the cluster, with
// nothing left that knows they exist.
func TestRenderApplicationCascadesOnDelete(t *testing.T) {
	r := &models.Request{
		Team: "core", ChartName: "postgres", ServiceName: "pg1", ChartVersion: "3.1.0",
		Cluster: "in-cluster", Namespace: "apps", ArgoCDAppName: "core-postgres-pg1",
	}
	g := newGitOps(t)
	out, err := g.RenderApplication(r, "https://gitlab/x.git")
	if err != nil {
		t.Fatalf("RenderApplication: %v", err)
	}
	var doc struct {
		Metadata struct {
			Finalizers []string `yaml:"finalizers"`
		} `yaml:"metadata"`
	}
	if err := yaml.Unmarshal([]byte(out), &doc); err != nil {
		t.Fatalf("rendered manifest is not valid YAML: %v\n%s", err, out)
	}
	if !slices.Contains(doc.Metadata.Finalizers, "resources-finalizer.argocd.argoproj.io") {
		t.Fatalf("metadata.finalizers = %v, want the Argo CD resources finalizer:\n%s",
			doc.Metadata.Finalizers, out)
	}
}

func metadataNamespace(t *testing.T, manifest string) string {
	t.Helper()
	var doc struct {
		Metadata struct {
			Namespace string `yaml:"namespace"`
		} `yaml:"metadata"`
	}
	if err := yaml.Unmarshal([]byte(manifest), &doc); err != nil {
		t.Fatalf("rendered manifest is not valid YAML: %v\n%s", err, manifest)
	}
	return doc.Metadata.Namespace
}

// TestRenderApplicationEscapesScalars: a field carrying a YAML-injection payload
// must not break the manifest structure (L12). Normal values stay bare.
func TestRenderApplicationEscapesScalars(t *testing.T) {
	g := newGitOps(t)

	// Malicious chart version trying to inject a sibling key + a destructive
	// syncPolicy. After escaping it must remain a plain string value.
	r := &models.Request{
		Team: "core", ChartName: "postgres", ServiceName: "pg1", ChartVersion: "1.0\ninjected: true",
		Cluster: "in-cluster", Namespace: "apps", ArgoCDAppName: "core-postgres-pg1",
	}
	out, err := g.RenderApplication(r, "https://gitlab/managed-services/team-core/postgres")
	if err != nil {
		t.Fatalf("RenderApplication: %v", err)
	}

	// Must still parse as a single valid YAML document with no injected top-level key.
	var doc map[string]any
	if err := yaml.Unmarshal([]byte(out), &doc); err != nil {
		t.Fatalf("rendered manifest is not valid YAML: %v\n%s", err, out)
	}
	if _, injected := doc["injected"]; injected {
		t.Fatalf("YAML injection succeeded:\n%s", out)
	}

	// A normal version is emitted bare (no churn / unnecessary quoting).
	r.ChartVersion = "3.1.0"
	out, _ = g.RenderApplication(r, "https://gitlab/x.git")
	if !strings.Contains(out, "targetRevision: 3.1.0") {
		t.Fatalf("normal version should be bare:\n%s", out)
	}
}
