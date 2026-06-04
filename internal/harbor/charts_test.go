package harbor

import (
	"context"
	"encoding/json"
	"testing"
)

// The ingress-gateway chart is vendored under charts/platform/ingress-gateway
// and must be served by the fake exactly like a Harbor-hosted chart.
func TestFakeServesEmbeddedGatewayChart(t *testing.T) {
	ctx := context.Background()
	f := NewFake()

	ch, err := f.GetChart(ctx, "platform", "ingress-gateway")
	if err != nil {
		t.Fatalf("GetChart: %v", err)
	}
	if ch.LatestVersion != "3.1.0" {
		t.Fatalf("latest version = %q, want 3.1.0", ch.LatestVersion)
	}

	schema, err := f.GetSchema(ctx, "platform", "ingress-gateway", "3.1.0")
	if err != nil {
		t.Fatalf("GetSchema: %v", err)
	}
	var doc map[string]any
	if err := json.Unmarshal(schema, &doc); err != nil {
		t.Fatalf("schema is not valid JSON: %v", err)
	}
	props, _ := doc["properties"].(map[string]any)
	if _, ok := props["gateways"]; !ok {
		t.Fatalf("schema missing top-level 'gateways' property")
	}
	if _, ok := props["xroutes"]; !ok {
		t.Fatalf("schema missing top-level 'xroutes' property")
	}

	if v, err := f.GetValues(ctx, "platform", "ingress-gateway", "3.1.0"); err != nil || len(v) == 0 {
		t.Fatalf("GetValues: err=%v len=%d", err, len(v))
	}
}
