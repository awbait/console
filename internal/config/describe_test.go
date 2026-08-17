package config

import (
	"reflect"
	"strings"
	"testing"
	"time"
)

// byName indexes a described config for lookups.
func byName(fields []Field) map[string]Field {
	out := make(map[string]Field, len(fields))
	for _, f := range fields {
		out[f.Name] = f
	}
	return out
}

// TestDescribeCoversEveryVariable is the reason Describe uses reflection: a
// variable added to Config must appear on the admin page without anyone
// remembering to list it here.
func TestDescribeCoversEveryVariable(t *testing.T) {
	got := byName(Describe(&Config{}))
	rt := reflect.TypeFor[Config]()
	for i := range rt.NumField() {
		name, _ := envKey(rt.Field(i).Tag.Get("env"))
		if name == "" {
			continue
		}
		if _, ok := got[name]; !ok {
			t.Errorf("%s is read by Config but missing from Describe", name)
		}
	}
	if len(got) == 0 {
		t.Fatal("Describe returned nothing")
	}
}

// A listed variable must accept the value it falls back to, or the portal would
// document one thing and refuse to start on it.
func TestOptionsIncludeTheDefault(t *testing.T) {
	rt := reflect.TypeFor[Config]()
	seen := map[string]bool{}
	for i := range rt.NumField() {
		ft := rt.Field(i)
		name, _ := envKey(ft.Tag.Get("env"))
		accepted, listed := options[name]
		if !listed {
			continue
		}
		seen[name] = true
		def := ft.Tag.Get("envDefault")
		if def == "" {
			continue // no default: nothing to check against
		}
		if !allowed(name, def) {
			t.Errorf("%s defaults to %q, which is not among %v", name, def, accepted)
		}
	}
	for name := range options {
		if !seen[name] {
			t.Errorf("%s has a list of accepted values but no field in Config", name)
		}
	}
}

// TestDescribeHidesSecrets is the one that must never regress: this payload goes
// over HTTP, and a token that reaches the browser is a leaked token.
func TestDescribeHidesSecrets(t *testing.T) {
	cfg := &Config{
		SessionSecret:      "s3cret-session",
		OIDCSecret:         "s3cret-oidc",
		HarborRobotToken:   "s3cret-harbor",
		HarborWebhookKey:   "s3cret-harbor-hook",
		GitLabToken:        "s3cret-gitlab",
		GitLabWebhookToken: "s3cret-gitlab-hook",
		ArgoCDToken:        "s3cret-argocd",
		DatabaseURL:        "postgres://portal:s3cret-db@db.internal:5432/portal?sslmode=disable",
		RedisURL:           "redis://:s3cret-redis@cache.internal:6379/0",
	}
	fields := Describe(cfg)

	for _, f := range fields {
		if strings.Contains(f.Value, "s3cret") {
			t.Errorf("%s leaked its value: %q", f.Name, f.Value)
		}
	}

	got := byName(fields)
	for _, name := range []string{
		"SESSION_SECRET", "OIDC_CLIENT_SECRET", "HARBOR_ROBOT_TOKEN", "HARBOR_WEBHOOK_SECRET",
		"GITLAB_TOKEN", "GITLAB_WEBHOOK_TOKEN", "ARGOCD_TOKEN",
	} {
		f := got[name]
		if !f.Secret || f.Value != "" {
			t.Errorf("%s: secret=%v value=%q, want a hidden value", name, f.Secret, f.Value)
		}
		if f.IsEmpty {
			t.Errorf("%s reads as unset, but it is configured", name)
		}
	}

	// Connection strings keep everything but the password: which database the
	// portal talks to is exactly what the page is for.
	db := got["DATABASE_URL"]
	if !strings.Contains(db.Value, "db.internal:5432") || !strings.Contains(db.Value, "***") {
		t.Errorf("DATABASE_URL = %q, want the host with the password masked", db.Value)
	}
	if db.Sensitive != "password" {
		t.Errorf("DATABASE_URL sensitive = %q, want %q", db.Sensitive, "password")
	}
}

// TestDescribeSecretByName covers the fallback: a credential nobody listed is
// still hidden, because forgetting the list must fail safe.
func TestDescribeSecretByName(t *testing.T) {
	for _, name := range []string{"NEW_API_TOKEN", "SOME_SECRET", "DB_PASSWORD"} {
		if !isSecret(name) {
			t.Errorf("%s is not treated as a secret", name)
		}
	}
	if isSecret("HARBOR_URL") {
		t.Error("HARBOR_URL is treated as a secret")
	}
}

// TestDescribeValues checks the shapes an admin actually reads: lists, durations,
// booleans, defaults and "set to something other than the default".
func TestDescribeValues(t *testing.T) {
	cfg := &Config{
		HarborProjects: []string{"platform", "managed-services"},
		HarborTimeout:  45 * time.Second,
		CookieSecure:   true,
		LogLevel:       "debug",
		HTTPPort:       "8080",
	}
	got := byName(Describe(cfg))

	if v := got["HARBOR_PROJECTS"].Value; v != "platform,managed-services" {
		t.Errorf("HARBOR_PROJECTS = %q, want the list joined by its separator", v)
	}
	if v := got["HARBOR_TIMEOUT"].Value; v != "45s" {
		t.Errorf("HARBOR_TIMEOUT = %q, want %q", v, "45s")
	}
	if v := got["COOKIE_SECURE"].Value; v != "true" {
		t.Errorf("COOKIE_SECURE = %q, want %q", v, "true")
	}
	if d := got["LOG_LEVEL"].Default; d != "info" {
		t.Errorf("LOG_LEVEL default = %q, want %q", d, "info")
	}
	if !got["LOG_LEVEL"].IsSet {
		t.Error("LOG_LEVEL=debug should read as set (it differs from the default)")
	}
	// Equal to the default is not "set": the page distinguishes what this
	// deployment chose from what it inherited.
	if got["HTTP_PORT"].IsSet || !got["HTTP_PORT"].IsDefault {
		t.Error("HTTP_PORT equals its default but does not read as default")
	}
	// A duration prints as "24h0m0s" while its tag says "24h" - the same value
	// written two ways must not read as a deliberate override.
	if ttl := byName(Describe(&Config{SessionTTL: 24 * time.Hour}))["SESSION_TTL"]; ttl.IsSet || !ttl.IsDefault {
		t.Errorf("SESSION_TTL = %q (default %q) reads as set, want default", ttl.Value, ttl.Default)
	}
	// The insecure shipped session secret must be visible as *not changed*,
	// otherwise the page reassures an admin who is still running with it.
	if s := byName(Describe(&Config{SessionSecret: DefaultSessionSecret}))["SESSION_SECRET"]; !s.IsDefault || s.IsSet {
		t.Error("an unchanged SESSION_SECRET does not read as the default one")
	}
	if !got["HARBOR_URL"].IsEmpty {
		t.Error("an unconfigured HARBOR_URL should read as empty")
	}
	if opts := got["LOG_LEVEL"].Options; len(opts) == 0 {
		t.Error("LOG_LEVEL offers no options, but it takes a fixed set")
	}
}

// TestDescribeGroups keeps the page's sections meaningful: nothing unsorted, and
// upstream variables next to their upstream.
func TestDescribeGroups(t *testing.T) {
	got := byName(Describe(&Config{}))
	want := map[string]string{
		"HARBOR_URL":           "harbor",
		"CHART_REGISTRY":       "harbor",
		"GITLAB_URL":           "gitlab",
		"ARGOCD_URL":           "argocd",
		"OIDC_ISSUER":          "auth",
		"SESSION_TTL":          "auth",
		"RBAC_ADMIN_GROUPS":    "rbac",
		"DATABASE_URL":         "storage",
		"STORE":                "storage",
		"STATUS_POLL_INTERVAL": "sync",
		"LOG_LEVEL":            "observability",
		"HTTP_PORT":            "portal",
	}
	for name, group := range want {
		if g := got[name].Group; g != group {
			t.Errorf("%s is in group %q, want %q", name, g, group)
		}
	}
}
