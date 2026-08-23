package checks

import (
	"context"
	"testing"

	"console/internal/config"
)

// run executes one check out of a set by id, so a test names the check the way
// the status page does.
func run(t *testing.T, set []Check, id string) Result {
	t.Helper()
	for _, c := range set {
		if c.ID == id {
			return c.Run(context.Background())
		}
	}
	t.Fatalf("no check %q in the set", id)
	return Result{}
}

func TestInstanceDirTemplate(t *testing.T) {
	cases := []struct {
		name string
		tmpl string
		want Verdict
	}{
		{"empty is the service name", "", VerdictOK},
		{"service name", "{{.ServiceName}}", VerdictOK},
		{"namespace and service name", "{{.Namespace}}-{{.ServiceName}}", VerdictOK},
		// The whole point of the check: two services of one team and chart would
		// commit into the same folder and overwrite each other.
		{"namespace alone", "{{.Namespace}}", VerdictFail},
		{"a constant", "instance", VerdictFail},
		{"broken template", "{{.ServiceName", VerdictFail},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := instanceDirTemplate(tc.tmpl); got.Verdict != tc.want {
				t.Fatalf("got %s/%s, want %s", got.Verdict, got.Reason, tc.want)
			}
		})
	}
}

func TestAppNameTemplate(t *testing.T) {
	cases := []struct {
		name   string
		tmpl   string
		want   Verdict
		reason string
	}{
		{"the shipped default", "{{.Team}}-{{.Chart}}-{{.ServiceName}}", VerdictOK, ""},
		{"no service name", "{{.Team}}-{{.Chart}}", VerdictFail, reasonNotUnique},
		{"no team", "{{.Chart}}-{{.ServiceName}}", VerdictWarn, reasonTeamCollision},
		{"no chart", "{{.Team}}-{{.ServiceName}}", VerdictWarn, reasonChartCollision},
		{"broken template", "{{.Team", VerdictFail, reasonBadTemplate},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := appNameTemplate(tc.tmpl)
			if got.Verdict != tc.want || got.Reason != tc.reason {
				t.Fatalf("got %s/%s, want %s/%s", got.Verdict, got.Reason, tc.want, tc.reason)
			}
		})
	}
}

func TestStaticSetIsComplete(t *testing.T) {
	cfg := &config.Config{StatusUpdateMode: config.StatusModeHybrid, ArgoCDAppNameTmpl: "{{.Team}}-{{.Chart}}-{{.ServiceName}}"}
	set := Static(cfg)
	want := []string{IDInstanceDirTmpl, IDAppNameTmpl}
	if len(set) != len(want) {
		t.Fatalf("static set has %d checks, want %d", len(set), len(want))
	}
	for _, id := range want {
		res := run(t, set, id)
		if res.Verdict == "" {
			t.Fatalf("check %q returned no verdict", id)
		}
	}
	// Every static check must be about the portal itself: they read the
	// configuration and nothing else, so none of them may be muted when an
	// upstream is down.
	for _, c := range set {
		if c.Component != ComponentPortal {
			t.Fatalf("static check %q belongs to %q, want %q", c.ID, c.Component, ComponentPortal)
		}
		if len(c.Vars) == 0 {
			t.Fatalf("check %q names no variables, so the page cannot say what to edit", c.ID)
		}
	}
}
