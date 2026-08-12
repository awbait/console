package views_test

import (
	"testing"

	"console/internal/views"
)

func TestReadGraphMapping(t *testing.T) {
	cases := []struct {
		name string
		doc  string
		want bool // a graph the portal will draw
	}{
		{"profile only", `{"graph":{"profile":"policies"}}`, true},
		{"no block", `{"views":{"order":{}}}`, false},
		{"switched off", `{"graph":{"profile":"policies","enabled":false}}`, false},
		{"switched on", `{"graph":{"profile":"policies","enabled":true}}`, true},
		{"unknown profile", `{"graph":{"profile":"eventmesh"}}`, false},
		{"no profile", `{"graph":{"entries":"/policies"}}`, false},
		{"broken json", `{"graph":`, false},
	}
	for _, c := range cases {
		got := views.ReadGraphMapping([]byte(c.doc)) != nil
		if got != c.want {
			t.Errorf("%s: has graph = %v, want %v", c.name, got, c.want)
		}
	}
}

// A version that renames the chart's fields has to be counted by its own names,
// or its orders would all read as empty and be refused.
func TestReadGraphMappingAppliesRenames(t *testing.T) {
	m := views.ReadGraphMapping([]byte(
		`{"graph":{"profile":"policies","entries":"/network/rules","entry":{"ingress":"incoming"}}}`))
	if m == nil {
		t.Fatal("no mapping")
	}
	if m.Entries != "/network/rules" {
		t.Errorf("Entries = %q, want %q", m.Entries, "/network/rules")
	}
	if m.Entry["ingress"] != "incoming" {
		t.Errorf("entry.ingress = %q, want %q", m.Entry["ingress"], "incoming")
	}
	if m.Entry["egress"] != "egress" {
		t.Errorf("entry.egress = %q, want the profile default %q", m.Entry["egress"], "egress")
	}
}

func TestCountGraphRules(t *testing.T) {
	plain := views.ReadGraphMapping([]byte(`{"graph":{"profile":"policies"}}`))
	cases := []struct {
		name   string
		values map[string]any
		want   int
	}{
		{"no section at all", map[string]any{"auth": map[string]any{}}, 0},
		{"empty list", map[string]any{"policies": []any{}}, 0},
		{"entry without rules", map[string]any{"policies": []any{
			map[string]any{"name": "app", "ingress": []any{}, "egress": []any{}},
		}}, 0},
		{"one incoming rule", map[string]any{"policies": []any{
			map[string]any{"name": "app", "ingress": []any{map[string]any{"ports": []any{80}}}},
		}}, 1},
		{"both directions across entries", map[string]any{"policies": []any{
			map[string]any{"name": "a", "egress": []any{map[string]any{}, map[string]any{}}},
			map[string]any{"name": "b", "ingress": []any{map[string]any{}}},
		}}, 3},
		{"section is not a list", map[string]any{"policies": "nope"}, 0},
	}
	for _, c := range cases {
		if got := plain.CountGraphRules(c.values); got != c.want {
			t.Errorf("%s: CountGraphRules = %d, want %d", c.name, got, c.want)
		}
	}
}

// Renamed fields are counted under their new names, not the profile's.
func TestCountGraphRulesWithRenames(t *testing.T) {
	m := views.ReadGraphMapping([]byte(
		`{"graph":{"profile":"policies","entries":"/network/rules","entry":{"ingress":"incoming"}}}`))
	values := map[string]any{"network": map[string]any{"rules": []any{
		map[string]any{"incoming": []any{map[string]any{}}, "ingress": []any{map[string]any{}}},
	}}}
	if got := m.CountGraphRules(values); got != 1 {
		t.Errorf("CountGraphRules = %d, want 1 (only the renamed field counts)", got)
	}
}
