package config

import (
	"fmt"
	"net/url"
	"reflect"
	"strings"
	"time"
)

// This file exposes the loaded configuration for the admin "Configuration"
// page: every variable the portal reads, what it is set to right now, and what
// it would have been by default. It is read-only by design - the portal is
// configured by its deployment, and a page that could change that would be a
// second, hidden source of truth.
//
// The struct tags in config.go stay the source of truth for names and defaults;
// everything here is derived from them by reflection, so a new variable shows up
// on the page as soon as it is added to Config.

// Field is one configuration variable as shown to a platform admin.
type Field struct {
	Name      string   `json:"name"`                // env var name, e.g. HARBOR_URL
	Group     string   `json:"group"`               // section it belongs to, derived from the name
	Value     string   `json:"value"`               // current value, masked when secret
	Default   string   `json:"default,omitempty"`   // value when the variable is unset
	Options   []string `json:"options,omitempty"`   // the values this variable accepts
	Secret    bool     `json:"secret"`              // value is hidden (credentials)
	IsSet     bool     `json:"is_set"`              // this deployment chose the value
	IsDefault bool     `json:"is_default"`          // the value is the one the portal ships with
	IsEmpty   bool     `json:"is_empty"`            // no value at all
	Sensitive string   `json:"sensitive,omitempty"` // why the value is partly hidden, if it is
}

// Groups, in the order both the admin page and the generated .env.example list
// them. A variable lands in the first group whose prefix it matches; anything
// else falls back to the first group, the portal itself, which is why that one
// carries no prefixes of its own.
//
// title and intro are the English heading of the section in .env.example. The
// Russian labels of the same sections are product copy and live with the rest
// of it, in web/src/pages/configText.ts.
var groups = []struct {
	prefixes []string
	name     string
	title    string
	intro    string
}{
	{nil, "portal", "The portal itself",
		"Where the portal listens and how it is reached from outside."},
	{[]string{"OIDC_", "AUTH_", "SESSION_"}, "auth", "Signing in",
		"Users sign in through an OIDC identity provider (Keycloak). AUTH_MODE has one runtime value: the no-Keycloak mode is a test stub and is rejected at startup."},
	{[]string{"RBAC_"}, "rbac", "Roles and teams",
		"Roles and teams are derived from the group claims of the identity provider.\n" +
			"\n" +
			"The team prefix is matched against every segment of a group path, so a prefixed segment anywhere resolves: /group/group/team-core/group gives the team core. The admin, support and security groups are matched by the full path with the leading slash stripped, so platform-admins matches /platform-admins but not a nested /x/platform-admins/y. A subgroup cannot escalate into a privileged role."},
	{[]string{"HARBOR_", "CHART_REGISTRY"}, "harbor", "Harbor, the chart registry",
		"Where the portal takes charts, their versions and their order forms from. Required: the portal does not start without it."},
	{[]string{"GITLAB_"}, "gitlab", "GitLab",
		"Holds the GitOps repositories of the teams and the merge requests orders travel through. Required."},
	{[]string{"ARGOCD_"}, "argocd", "Argo CD",
		"Deploys what the portal commits and reports the state of it back. Required."},
	{[]string{"DATABASE_", "REDIS_", "STORE", "CACHE"}, "storage", "Storage",
		"Memory needs no infrastructure and is lost on restart; postgres and redis need the connections below."},
	{[]string{"STATUS_", "DRIFT_", "IMPORT_", "CATALOG_"}, "sync", "Keeping state fresh",
		"hybrid: a periodic reconcile plus notifications from GitLab and Harbor that trigger an immediate sweep, with the poll left on as a safety net. Without the webhook secrets set this is polling alone, which is the right local behaviour.\n" +
			"\n" +
			"webhook: notifications only, no periodic poll. A startup sweep still runs, but a notification that never arrives is not retried until the next restart, so use this only where delivery is reliable. Needs GITLAB_WEBHOOK_TOKEN."},
	{[]string{"LOG_", "GRAFANA_", "METRICS_"}, "observability", "Logs and metrics",
		"What the portal writes about itself."},
}

// options lists the accepted values of the variables that take a fixed set of
// them. Booleans and durations are not listed here - their shape is obvious from
// the value and the default.
var options = map[string][]string{
	"STORE":              {"postgres", "memory"},
	"CACHE":              {"redis", "memory"},
	"AUTH_MODE":          {"oidc"},
	"STATUS_UPDATE_MODE": {StatusModeHybrid, StatusModeWebhook},
	"LOG_LEVEL":          {"debug", "info", "warn", "error"},
	"LOG_FORMAT":         {"json", "text"},
}

// secrets are the variables whose value never leaves the process. Listed by
// name rather than guessed, and backed by the suffix check in isSecret so a new
// credential is hidden even if someone forgets this list.
var secrets = map[string]bool{
	"SESSION_SECRET":        true,
	"OIDC_CLIENT_SECRET":    true,
	"HARBOR_ROBOT_TOKEN":    true,
	"HARBOR_WEBHOOK_SECRET": true,
	"GITLAB_TOKEN":          true,
	"GITLAB_WEBHOOK_TOKEN":  true,
	"ARGOCD_TOKEN":          true,
}

// credentialURLs carry a password inside a connection string. They are shown
// with the password removed rather than hidden outright: which host and database
// the portal talks to is exactly what an admin opens this page for.
var credentialURLs = map[string]bool{
	"DATABASE_URL": true,
	"REDIS_URL":    true,
}

// isSecret reports whether a variable's value must be hidden. The name-based
// fallback (SECRET/TOKEN/PASSWORD) is deliberate: forgetting to list a new
// credential should hide it, not leak it.
func isSecret(name string) bool {
	if secrets[name] {
		return true
	}
	for _, marker := range []string{"SECRET", "TOKEN", "PASSWORD"} {
		if strings.Contains(name, marker) {
			return true
		}
	}
	return false
}

// Describe returns every configuration variable with its current value, for the
// admin configuration page. Secrets are reported as set/unset only, and
// connection strings come back without their password.
func Describe(cfg *Config) []Field {
	rv := reflect.ValueOf(*cfg)
	rt := rv.Type()
	out := make([]Field, 0, rt.NumField())
	for i := range rt.NumField() {
		ft := rt.Field(i)
		name := ft.Tag.Get("env")
		if name == "" {
			continue
		}
		def := ft.Tag.Get("envDefault")
		value := renderValue(rv.Field(i), ft.Tag.Get("envSeparator"))
		isDefault := value != "" && equalsDefault(rv.Field(i), value, def)
		f := Field{
			Name:      name,
			Group:     groupOf(name),
			Default:   def,
			Options:   options[name],
			Secret:    isSecret(name),
			IsEmpty:   value == "",
			IsDefault: isDefault,
			IsSet:     value != "" && !isDefault,
		}
		switch {
		case f.Secret:
			// Never the value, not even truncated: a prefix of a token is still a
			// prefix of a token. Whether it is configured at all is the useful part.
			f.Value = ""
		case credentialURLs[name]:
			f.Value = redactURLPassword(value)
			if f.Value != value {
				f.Sensitive = "password"
			}
		default:
			f.Value = value
		}
		out = append(out, f)
	}
	return out
}

// equalsDefault compares a rendered value with the default from the struct tag.
// Durations are compared as durations: the tag says "24h" while the value prints
// as "24h0m0s", and reading that as "this deployment set it" would put a "set by
// you" mark on half the page.
func equalsDefault(v reflect.Value, value, def string) bool {
	if value == def {
		return true
	}
	if _, isDuration := v.Interface().(time.Duration); !isDuration {
		return false
	}
	a, errA := time.ParseDuration(value)
	b, errB := time.ParseDuration(def)
	return errA == nil && errB == nil && a == b
}

// groupOf sorts a variable into its section by name prefix.
func groupOf(name string) string {
	for _, g := range groups {
		for _, p := range g.prefixes {
			if strings.HasPrefix(name, p) {
				return g.name
			}
		}
	}
	return groups[0].name
}

// renderValue prints a config value the way its env var would have been written:
// lists joined by their separator, durations in Go's own notation, everything
// else through fmt.
func renderValue(v reflect.Value, sep string) string {
	if sep == "" {
		sep = ","
	}
	switch v.Kind() {
	case reflect.Slice:
		parts := make([]string, v.Len())
		for i := range v.Len() {
			parts[i] = fmt.Sprint(v.Index(i).Interface())
		}
		return strings.Join(parts, sep)
	case reflect.Int64:
		if d, ok := v.Interface().(time.Duration); ok {
			return d.String()
		}
		return fmt.Sprint(v.Interface())
	default:
		return fmt.Sprint(v.Interface())
	}
}

// redactURLPassword strips the password from a connection string, keeping the
// scheme, user, host and path. A value that does not parse as a URL is dropped
// entirely rather than guessed at - it may be a DSN with the password inline.
func redactURLPassword(raw string) string {
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil || u.User == nil {
		if err != nil {
			return ""
		}
		return raw
	}
	if _, hasPassword := u.User.Password(); !hasPassword {
		return raw
	}
	// Via a placeholder rather than by writing "***" straight into the URL:
	// String() percent-encodes whatever it is given, and "***" would come back
	// escaped. The placeholder survives encoding untouched.
	u.User = url.UserPassword(u.User.Username(), "xxxxx")
	return strings.Replace(u.String(), ":xxxxx@", ":***@", 1)
}
