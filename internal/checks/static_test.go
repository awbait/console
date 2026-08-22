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

func TestWebhookPairing(t *testing.T) {
	cases := []struct {
		name       string
		url, token string
		mode       string
		want       Verdict
		reason     string
	}{
		{"both set", "http://p/api/v1/webhooks/gitlab", "s", config.StatusModeHybrid, VerdictOK, ""},
		{"url without token", "http://p/api/v1/webhooks/gitlab", "", config.StatusModeHybrid, VerdictWarn, reasonURLWithoutToken},
		{"token without url", "", "s", config.StatusModeHybrid, VerdictWarn, reasonTokenWithoutURL},
		{"neither, polling", "", "", config.StatusModeHybrid, VerdictSkip, ReasonNotConfigured},
		// Startup refuses this combination outright, so it should never be seen
		// on a running portal - but if it ever is, it is not a skip.
		{"neither, webhook only", "", "", config.StatusModeWebhook, VerdictFail, ReasonNotConfigured},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := &config.Config{GitLabWebhookURL: tc.url, GitLabWebhookToken: tc.token, StatusUpdateMode: tc.mode}
			got := webhookPairing(cfg)
			if got.Verdict != tc.want || (tc.reason != "" && got.Reason != tc.reason) {
				t.Fatalf("got %s/%s, want %s/%s", got.Verdict, got.Reason, tc.want, tc.reason)
			}
		})
	}
}

func TestWebhookURL(t *testing.T) {
	cases := []struct {
		name         string
		hook, public string
		want         Verdict
		reason       string
	}{
		{"same origin", "https://p.example.com" + GitLabWebhookPath, "https://p.example.com", VerdictOK, ""},
		{"trailing slash on the hook", "https://p.example.com" + GitLabWebhookPath + "/", "https://p.example.com", VerdictOK, ""},
		// GitLab in a container reaches the portal by another name. Legitimate,
		// and worth showing both addresses next to each other.
		{"another host", "http://host.docker.internal:8080" + GitLabWebhookPath, "http://localhost:8080", VerdictWarn, reasonHostMismatch},
		{"another scheme", "https://localhost:8080" + GitLabWebhookPath, "http://localhost:8080", VerdictWarn, reasonSchemeMismatch},
		{"wrong path", "https://p.example.com/hooks/gitlab", "https://p.example.com", VerdictFail, reasonPathMismatch},
		{"not a url", "not a url", "https://p.example.com", VerdictFail, reasonPathMismatch},
		{"unset", "", "https://p.example.com", VerdictSkip, ReasonNotConfigured},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := webhookURL(&config.Config{GitLabWebhookURL: tc.hook, PublicURL: tc.public})
			if got.Verdict != tc.want || (tc.reason != "" && got.Reason != tc.reason) {
				t.Fatalf("got %s/%s, want %s/%s", got.Verdict, got.Reason, tc.want, tc.reason)
			}
		})
	}
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
	want := []string{IDWebhookPairing, IDWebhookURL, IDInstanceDirTmpl, IDAppNameTmpl, IDAutoMerge, IDHarborWebhookSetup}
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

func TestAutoMerge(t *testing.T) {
	if got := autoMerge(false); got.Verdict != VerdictOK {
		t.Fatalf("off: got %s, want ok", got.Verdict)
	}
	if got := autoMerge(true); got.Verdict != VerdictWarn || got.Reason != reasonEnabled {
		t.Fatalf("on: got %s/%s, want warn/%s", got.Verdict, got.Reason, reasonEnabled)
	}
}
