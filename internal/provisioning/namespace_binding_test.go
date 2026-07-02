package provisioning_test

import (
	"context"
	"encoding/json"
	"testing"

	"console/internal/provisioning"
	"console/pkg/models"

	"gopkg.in/yaml.v3"
)

// seedNSBindingView registers an approved order view that binds the order's
// destination namespace to a values pointer (managed-namespace style: the chart
// provisions its own namespace and names it through that value).
func seedNSBindingView(ctx context.Context, t *testing.T, s *stack, chart, nsPtr string) {
	t.Helper()
	view := json.RawMessage(`{"views":{"order":{"identity":"` + nsPtr + `","namespace":"` + nsPtr + `"}}}`)
	p := &models.ChartPublication{
		ID:               "pub-ns-" + chart,
		ChartProject:     "platform",
		ChartName:        chart,
		Status:           models.PubApproved,
		ApprovedViewJSON: view,
	}
	if err := s.st.CreatePublication(ctx, p); err != nil {
		t.Fatalf("seed publication: %v", err)
	}
}

// TestNamespaceBindingMirrorsIntoValues: a chart whose order view declares a
// "namespace" binding has the order's destination namespace mirrored into that
// values field, overwriting whatever the form submitted. This keeps a
// self-provisioning chart rendered into the namespace it creates, and the deploy
// identity (also that field) resolves from the mirrored value.
func TestNamespaceBindingMirrorsIntoValues(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")
	seedNSBindingView(ctx, t, s, "postgres", "/namespace/namespaceName")

	r, err := s.prov.Create(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "ns1", Namespace: "team-alpha",
		Values: map[string]any{"namespace": map[string]any{"namespaceName": "stale"}},
		Draft:  true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if r.Namespace != "team-alpha" {
		t.Fatalf("destination namespace = %q, want team-alpha", r.Namespace)
	}
	var got map[string]any
	if err := yaml.Unmarshal([]byte(r.ValuesYAML), &got); err != nil {
		t.Fatalf("unmarshal values: %v", err)
	}
	ns, _ := got["namespace"].(map[string]any)
	if ns["namespaceName"] != "team-alpha" {
		t.Fatalf("namespaceName = %v, want team-alpha (mirrored from destination namespace)", ns["namespaceName"])
	}
	if r.ResourceIdentity != "team-alpha" {
		t.Fatalf("resource identity = %q, want team-alpha", r.ResourceIdentity)
	}
}

// TestNamespaceBindingFallsBackToServiceName: with no destination namespace
// supplied the order falls back to service_name, and the binding mirrors that
// fallback so values stay consistent with destination.namespace.
func TestNamespaceBindingFallsBackToServiceName(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")
	seedNSBindingView(ctx, t, s, "postgres", "/namespace/namespaceName")

	r, err := s.prov.Create(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "svc-ns", Values: map[string]any{}, Draft: true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if r.Namespace != "svc-ns" {
		t.Fatalf("destination namespace = %q, want svc-ns (service_name fallback)", r.Namespace)
	}
	var got map[string]any
	if err := yaml.Unmarshal([]byte(r.ValuesYAML), &got); err != nil {
		t.Fatalf("unmarshal values: %v", err)
	}
	ns, _ := got["namespace"].(map[string]any)
	if ns["namespaceName"] != "svc-ns" {
		t.Fatalf("namespaceName = %v, want svc-ns (mirrored fallback)", ns["namespaceName"])
	}
}

// seedNSView registers an approved order view with a raw order block (object-form
// namespace directive).
func seedNSView(ctx context.Context, t *testing.T, s *stack, chart, orderJSON string) {
	t.Helper()
	view := json.RawMessage(`{"views":{"order":` + orderJSON + `}}`)
	p := &models.ChartPublication{
		ID:               "pub-ns-" + chart,
		ChartProject:     "platform",
		ChartName:        chart,
		Status:           models.PubApproved,
		ApprovedViewJSON: view,
	}
	if err := s.st.CreatePublication(ctx, p); err != nil {
		t.Fatalf("seed publication: %v", err)
	}
}

// TestNamespaceSourceValues: a source=values directive sources destination
// namespace from a values field (no order form input, no mirror). The chart's own
// value drives destination.namespace and the deploy identity.
func TestNamespaceSourceValues(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")
	seedNSView(ctx, t, s, "postgres",
		`{"identity":"/namespace/namespaceName","namespace":{"source":"values","pointer":"/namespace/namespaceName","hideOrderField":true}}`)

	r, err := s.prov.Create(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "team-beta", Namespace: "", // hidden field: no input
		Values: map[string]any{"namespace": map[string]any{"namespaceName": "team-beta"}},
		Draft:  true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if r.Namespace != "team-beta" {
		t.Fatalf("destination namespace = %q, want team-beta (from values)", r.Namespace)
	}
	if r.ResourceIdentity != "team-beta" {
		t.Fatalf("resource identity = %q, want team-beta", r.ResourceIdentity)
	}
	var got map[string]any
	if err := yaml.Unmarshal([]byte(r.ValuesYAML), &got); err != nil {
		t.Fatalf("unmarshal values: %v", err)
	}
	ns, _ := got["namespace"].(map[string]any)
	if ns["namespaceName"] != "team-beta" {
		t.Fatalf("namespaceName = %v, want team-beta (unchanged, not mirrored)", ns["namespaceName"])
	}
}

// TestNamespaceSourceFixed: a source=fixed directive pins destination namespace to
// a constant from the view, ignoring any order input (operator / cluster-scoped).
func TestNamespaceSourceFixed(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")
	seedNSView(ctx, t, s, "postgres",
		`{"namespace":{"source":"fixed","value":"platform-system","hideOrderField":true}}`)

	r, err := s.prov.Create(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "operator", Namespace: "", Values: map[string]any{}, Draft: true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if r.Namespace != "platform-system" {
		t.Fatalf("destination namespace = %q, want platform-system (fixed)", r.Namespace)
	}
}
