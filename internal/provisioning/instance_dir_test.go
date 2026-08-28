package provisioning_test

import (
	"context"
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

// newTemplatedStack is the ordinary flow with a non-default instance folder.
func newTemplatedStack(t *testing.T, tmpl string) (*provisioning.Service, *gitlab.Fake, store.Store, *provisioning.GitOps) {
	t.Helper()
	st := store.NewMemory()
	gl := gitlab.NewFake("managed-services", []string{"team-core"}, true) // auto-merge
	gitops, err := provisioning.NewGitOps("managed-services", "team-{{.Team}}",
		"{{.Team}}-{{.Chart}}-{{.ServiceName}}", "portal-managed", "main")
	if err != nil {
		t.Fatal(err)
	}
	if err := gitops.SetInstanceTemplate(tmpl); err != nil {
		t.Fatal(err)
	}
	prov := provisioning.New(st, gl, argocd.NewFake(gl),
		catalog.New(harbor.NewFake(), cache.NewMemory()), gitops, events.New(), "in-cluster", "main", true)
	return prov, gl, st, gitops
}

func TestOrderCommitsIntoTheTemplatedFolder(t *testing.T) {
	ctx := context.Background()
	prov, gl, st, _ := newTemplatedStack(t, "{{.Chart}}-{{.ServiceName}}")

	r, err := prov.Create(ctx, member("core"), provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "pg1", Namespace: "payments", Values: validValues(),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// The folder is recorded on the order, not recomputed on every use.
	if got, want := r.InstancePath, "in-cluster/payments/postgres-pg1"; got != want {
		t.Fatalf("InstancePath = %q, want %q", got, want)
	}
	saved, err := st.GetRequest(ctx, r.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if saved.InstancePath != r.InstancePath {
		t.Fatalf("InstancePath not persisted: %q", saved.InstancePath)
	}

	proj, err := gl.GetProject(ctx, "managed-services/team-core/postgres")
	if err != nil {
		t.Fatalf("repo: %v", err)
	}
	for _, name := range []string{"application.yaml", "values.yaml"} {
		if _, ferr := gl.GetFile(ctx, proj.ID, "in-cluster/payments/postgres-pg1/"+name, "main"); ferr != nil {
			t.Fatalf("%s not committed into the templated folder: %v", name, ferr)
		}
	}
	// The values reference in application.yaml points at the same folder, or Argo
	// CD renders the chart with no values at all.
	app, err := gl.GetFile(ctx, proj.ID, "in-cluster/payments/postgres-pg1/application.yaml", "main")
	if err != nil {
		t.Fatalf("application.yaml: %v", err)
	}
	if !strings.Contains(string(app), "$values/in-cluster/payments/postgres-pg1/values.yaml") {
		t.Fatalf("values reference does not follow the folder:\n%s", app)
	}
}

// An order created under one template keeps its folder when the template
// changes. Following the new one would leave the portal writing to, reading
// drift from and deleting a folder its files are not in.
func TestTemplateChangeLeavesExistingOrdersAlone(t *testing.T) {
	ctx := context.Background()
	prov, gl, st, gitops := newTemplatedStack(t, "") // default: the service name

	u := member("core")
	r, err := prov.Create(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "pg1", Namespace: "payments", Values: validValues(),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if got, want := r.InstancePath, "in-cluster/payments/pg1"; got != want {
		t.Fatalf("InstancePath = %q, want %q", got, want)
	}

	// The operator changes the layout. Deleting the old order must still find
	// its files, which is where a recomputed path would go wrong most quietly:
	// an empty folder listing closes the order out and leaves the service
	// running with nobody tracking it.
	if err := gitops.SetInstanceTemplate("{{.Chart}}-{{.ServiceName}}"); err != nil {
		t.Fatal(err)
	}
	for range 4 {
		_ = prov.Reconcile(ctx)
	}
	if _, err := prov.Delete(ctx, u, r.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	for range 4 {
		_ = prov.Reconcile(ctx)
	}

	proj, err := gl.GetProject(ctx, "managed-services/team-core/postgres")
	if err != nil {
		t.Fatalf("repo: %v", err)
	}
	if _, ferr := gl.GetFile(ctx, proj.ID, "in-cluster/payments/pg1/application.yaml", "main"); ferr == nil {
		t.Fatal("the order's own manifests are still in Git after a delete")
	}
	got, err := st.GetRequest(ctx, r.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.InstancePath != "in-cluster/payments/pg1" {
		t.Fatalf("InstancePath moved to %q", got.InstancePath)
	}
}

// Rows written before the folder was stored keep the layout they were created
// with, rather than being read as an order with no folder at all.
func TestLegacyOrderWithoutInstancePath(t *testing.T) {
	gitops, err := provisioning.NewGitOps("managed-services", "team-{{.Team}}",
		"{{.Team}}-{{.Chart}}-{{.ServiceName}}", "portal-managed", "main")
	if err != nil {
		t.Fatal(err)
	}
	if err := gitops.SetInstanceTemplate("{{.Chart}}-{{.ServiceName}}"); err != nil {
		t.Fatal(err)
	}
	legacy := &models.Request{Team: "core", ChartName: "postgres", ServiceName: "pg1",
		Cluster: "in-cluster", Namespace: "payments"}

	if got, want := gitops.ValuesPath(legacy), "in-cluster/pg1/values.yaml"; got != want {
		t.Fatalf("ValuesPath = %q, want %q", got, want)
	}
}
