package provisioning_test

import (
	"context"
	"strings"
	"testing"

	"console/internal/provisioning"
	"console/pkg/models"
)

// TestOrderAppliesViewDefaults: an order for a chart whose approved view declares
// a "defaults" block gets those values stamped into the persisted values YAML,
// overwriting any submitted value (provenance-style stamping, e.g.
// namespace.creator=console). The rule lives in the view document, not in code.
func TestOrderAppliesViewDefaults(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")

	view := []byte(`{"views":{"order":{"identity":"/auth/database"}},"defaults":{"/auth/creator":"console"}}`)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", view)

	mk := func(service, ns string, values map[string]any) (*models.Request, error) {
		return s.prov.Create(ctx, u, provisioning.CreateInput{
			ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
			Team: "core", ServiceName: service, Namespace: ns, Values: values, Draft: true,
		})
	}

	// Field absent in the order -> stamped in.
	r, err := mk("alpha", "ns-a", draft("app"))
	if err != nil {
		t.Fatalf("create alpha: %v", err)
	}
	if !strings.Contains(r.ValuesYAML, "creator: console") {
		t.Fatalf("default not stamped, values:\n%s", r.ValuesYAML)
	}

	// Field submitted as something else -> overwritten ("перезапись").
	r2, err := mk("bravo", "ns-b", map[string]any{"auth": map[string]any{"database": "app", "creator": "lk"}})
	if err != nil {
		t.Fatalf("create bravo: %v", err)
	}
	if strings.Contains(r2.ValuesYAML, "creator: lk") || !strings.Contains(r2.ValuesYAML, "creator: console") {
		t.Fatalf("submitted value not overwritten, values:\n%s", r2.ValuesYAML)
	}
}

// TestOrderWithoutViewKeepsValues: with no published view (and thus no defaults),
// order values are persisted unchanged.
func TestOrderWithoutViewKeepsValues(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")

	r, err := s.prov.Create(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "alpha", Namespace: "ns-a", Values: draft("app"), Draft: true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if strings.Contains(r.ValuesYAML, "creator") {
		t.Fatalf("unexpected stamped value without a view:\n%s", r.ValuesYAML)
	}
}
