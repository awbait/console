package status

import "testing"

// states builds a component snapshot where the named components are down and
// every other known component is up.
func states(down ...string) []ComponentState {
	all := []string{"keycloak", "harbor", "gitlab", "argocd", "store", "cache"}
	isDown := make(map[string]bool, len(down))
	for _, n := range down {
		isDown[n] = true
	}
	out := make([]ComponentState, 0, len(all))
	for _, n := range all {
		out = append(out, ComponentState{Name: n, OK: !isDown[n]})
	}
	return out
}

// broken lists the capabilities that do not work, for a readable diff.
func broken(caps []CapabilityState) []string {
	var out []string
	for _, c := range caps {
		if !c.OK {
			out = append(out, c.ID)
		}
	}
	return out
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestEvaluate(t *testing.T) {
	cases := []struct {
		name string
		down []string
		want []string
	}{
		{"everything up", nil, nil},
		// Redis only speeds up chart blobs, so losing it costs no capability.
		{"cache down", []string{"cache"}, nil},
		{"keycloak down", []string{"keycloak"}, []string{CapSignIn}},
		{"harbor down", []string{"harbor"}, []string{CapCatalog, CapOrdering, CapPublishing}},
		{"gitlab down", []string{"gitlab"}, []string{CapOrdering}},
		{"argocd down", []string{"argocd"}, []string{CapDeployStatus}},
		{"store down", []string{"store"}, []string{CapCatalog, CapOrdering, CapOrders, CapDeployStatus, CapPublishing}},
		{
			"harbor and gitlab down",
			[]string{"harbor", "gitlab"},
			[]string{CapCatalog, CapOrdering, CapPublishing},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			caps := Evaluate(states(tc.down...))
			if len(caps) != len(Capabilities) {
				t.Fatalf("got %d capabilities, want %d", len(caps), len(Capabilities))
			}
			if got := broken(caps); !equal(got, tc.want) {
				t.Fatalf("broken = %v, want %v", got, tc.want)
			}
			if got, want := AllOK(caps), tc.want == nil; got != want {
				t.Fatalf("AllOK = %v, want %v", got, want)
			}
		})
	}
}

// TestEvaluateWithoutProbes covers the wiring where no monitor is attached
// (tests, early startup): with nothing probed, nothing is declared broken.
func TestEvaluateWithoutProbes(t *testing.T) {
	caps := Evaluate(nil)
	if !AllOK(caps) {
		t.Fatalf("no probe results: %v, want every capability OK", broken(caps))
	}
}
