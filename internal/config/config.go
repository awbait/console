// Package config loads runtime configuration from the environment.
package config

import (
	"fmt"
	"time"

	"github.com/caarlos0/env/v11"
)

// Status update modes (STATUS_UPDATE_MODE) select how order and catalog state is
// kept fresh:
//   - hybrid (default): periodic reconcile PLUS inbound GitLab/Harbor webhooks
//     that trigger an immediate sweep; the poll stays on as a safety net. With no
//     webhook secrets set this degrades to poll-only, which is the right local /
//     fakes behaviour (no webhook infra to point at the portal). STATUS_POLL_
//     INTERVAL is the safety-net cadence; raise it once webhooks are wired.
//   - webhook: webhooks only, no periodic poll. A startup sweep still runs (to
//     catch up after downtime), but a missed/undelivered webhook is NOT retried
//     until the next restart. Requires GITLAB_WEBHOOK_TOKEN (without it the order
//     lifecycle would never advance). Use only with reliable webhook delivery.
//
// There is no poll-only mode: use hybrid without webhook secrets for that.
const (
	StatusModeHybrid  = "hybrid"
	StatusModeWebhook = "webhook"
)

// DefaultSessionSecret is the insecure development default for SESSION_SECRET.
// Keep it in sync with the envDefault tag below; buildAuth refuses to start in
// AUTH_MODE=oidc while the secret still equals this value.
const DefaultSessionSecret = "dev-insecure-session-secret-change-me"

// Config is the full portal configuration. Defaults favour a local
// fakes-only run so the whole portal boots with just Postgres+Redis
// (or fully in-memory in tests).
//
// Every field carries what it is for in its `doc` tag, and a sample value in
// `example` where the default cannot be one. That is the single source those
// sentences are written in: the root .env.example is generated from them (see
// envexample.go and `make env-example`), and a test fails if the file in the
// repository has drifted from what the tags say.
//
// There is no upstream "mode": the portal always talks to the real Harbor,
// GitLab and Argo CD, and refuses to start without their URLs and tokens. The
// in-memory fakes next to each client exist for tests only - a deployment that
// could switch to them by one environment variable is a deployment that can
// silently serve made-up charts.
type Config struct {
	// Server
	HTTPPort  string `env:"HTTP_PORT" envDefault:"8080" doc:"Port the portal serves its API and UI on."`
	PublicURL string `env:"PUBLIC_URL" envDefault:"http://localhost:8080" doc:"External address the portal is opened at."`
	// Its own listener, separate from the API port, so scraping is not exposed
	// through the public app ingress.
	MetricsPort string `env:"METRICS_PORT" envDefault:"2112" doc:"Separate port for Prometheus metrics, kept off the public ingress."`
	GrafanaURL  string `env:"GRAFANA_URL" doc:"Base address of Grafana. When set, the status page links to it; empty hides the link." example:"http://localhost:3000"`
	// Defaults to true: production runs over HTTPS, and localhost is a secure
	// context even on plain http.
	CookieSecure bool `env:"COOKIE_SECURE" envDefault:"true" doc:"Send the session cookie over HTTPS only. Turn it off only for a plain-HTTP stand that is not localhost."`

	Store string `env:"STORE" envDefault:"memory" doc:"Where orders, publications and categories are kept."`
	Cache string `env:"CACHE" envDefault:"memory" doc:"Where cached chart files are kept."`

	// AuthMode must be "oidc" (the only runtime mode). The no-Keycloak "dev" mode
	// is a test stub only and is rejected at startup.
	AuthMode       string        `env:"AUTH_MODE" envDefault:"oidc" doc:"How users sign in. There is one runtime mode: through the identity provider."`
	OIDCIssuer     string        `env:"OIDC_ISSUER" doc:"Realm address of the identity provider. Must match the issuer its tokens carry, which is host-sensitive." example:"http://localhost:8081/realms/internal"`
	OIDCClientID   string        `env:"OIDC_CLIENT_ID" doc:"Identifier of the portal as a client of the identity provider." example:"portal"`
	OIDCSecret     string        `env:"OIDC_CLIENT_SECRET" doc:"Secret of that client." example:"portal-secret"`
	OIDCRedirect   string        `env:"OIDC_REDIRECT_URL" doc:"Address the browser is returned to after signing in. Must be allowed in the realm." example:"http://localhost:8080/api/v1/auth/callback"`
	OIDCPostLogin  string        `env:"OIDC_POST_LOGIN_REDIRECT" envDefault:"/" doc:"Where the browser goes after a successful sign-in."`
	OIDCPostLogout string        `env:"OIDC_POST_LOGOUT_REDIRECT" doc:"Where the browser goes after signing out. Must be registered as a post-logout address on the client; empty reuses the sign-in one." example:"http://localhost:5173/"`
	OIDCScopes     []string      `env:"OIDC_SCOPES" envSeparator:"," envDefault:"openid,profile,email,groups" doc:"What the portal asks the identity provider about the user. Groups are what roles and teams are built from."`
	SessionSecret  string        `env:"SESSION_SECRET" envDefault:"dev-insecure-session-secret-change-me" doc:"Key the session is encrypted with. The portal refuses to start while it is still this one."`
	SessionCookie  string        `env:"SESSION_COOKIE_NAME" envDefault:"idp_session" doc:"Name of the cookie the session is kept in."`
	SessionTTL     time.Duration `env:"SESSION_TTL" envDefault:"24h" doc:"How long a session lives without signing in again."`

	AdminGroups     []string `env:"RBAC_ADMIN_GROUPS" envSeparator:"," doc:"Groups granting the platform administrator role. Empty means nobody has it." example:"platform-admins"`
	SupportGroups   []string `env:"RBAC_SUPPORT_GROUPS" envSeparator:"," doc:"Groups granting the support role: the orders of every team, without creating or deleting them." example:"support"`
	SecurityGroups  []string `env:"RBAC_SECURITY_GROUPS" envSeparator:"," doc:"Groups granting the information security role: the security section and policy orders." example:"security"`
	TeamGroupPrefix string   `env:"RBAC_TEAM_GROUP_PREFIX" envDefault:"team-" doc:"Prefix marking the groups a user's teams are taken from."`
	// Lets an external IdP with a different or nested group structure map to
	// teams without renaming its groups.
	TeamGroupRegex string `env:"RBAC_TEAM_GROUP_REGEX" doc:"Expression whose first capture group is the team name. When set it is used instead of the prefix." example:"(?:^|/)team-([^/]+)"`

	HarborURL         string        `env:"HARBOR_URL" doc:"Address of Harbor, without the API suffix." example:"https://host.docker.internal:8084" required:"true"`
	HarborRobotUser   string        `env:"HARBOR_ROBOT_USER" doc:"Robot account the portal reads charts as. Empty reads them anonymously, which only works for public projects."`
	HarborRobotToken  string        `env:"HARBOR_ROBOT_TOKEN" doc:"Password of that robot account."`
	HarborProjects    []string      `env:"HARBOR_PROJECTS" envSeparator:"," envDefault:"platform,managed-services" doc:"Harbor projects the catalog is built from."`
	HarborWebhookKey  string        `env:"HARBOR_WEBHOOK_SECRET" doc:"Shared secret authenticating notifications from Harbor. Set the same value as the webhook auth header there; empty leaves the portal to find new charts by polling."`
	HarborInsecureTLS bool          `env:"HARBOR_INSECURE_TLS" envDefault:"false" doc:"Skip verification of the Harbor certificate. For stands with a self-signed one."`
	HarborTimeout     time.Duration `env:"HARBOR_TIMEOUT" envDefault:"30s" doc:"How long to wait for a Harbor response."`

	GitLabURL           string        `env:"GITLAB_URL" doc:"Address of GitLab." example:"http://localhost:8929" required:"true"`
	GitLabToken         string        `env:"GITLAB_TOKEN" doc:"Token the portal creates repositories and merge requests with. Needs the api scope." example:"glpat-localdev0123456789abcd" required:"true"`
	GitLabTimeout       time.Duration `env:"GITLAB_TIMEOUT" envDefault:"30s" doc:"How long to wait for a GitLab response."`
	GitLabAutoMerge     bool          `env:"GITLAB_AUTO_MERGE" envDefault:"false" doc:"Merge the portal's own merge requests without waiting for a human."`
	GitLabGitopsGroup   string        `env:"GITLAB_GITOPS_GROUP" envDefault:"managed-services" doc:"Top-level group the GitOps repositories live in."`
	GitLabSubgroupTmpl  string        `env:"GITLAB_TEAM_SUBGROUP_TEMPLATE" envDefault:"team-{{.Team}}" doc:"Template for a team's subgroup path inside that group."`
	GitLabDefaultBranch string        `env:"GITLAB_DEFAULT_BRANCH" envDefault:"main" doc:"Branch order changes are merged into and Argo CD tracks."`
	GitLabWebhookToken  string        `env:"GITLAB_WEBHOOK_TOKEN" doc:"Secret verifying notifications from GitLab. Set the same value as the webhook secret token there; empty leaves the portal to find merges by polling."`

	ArgoCDURL     string `env:"ARGOCD_URL" doc:"Address of Argo CD." example:"http://localhost:8083" required:"true"`
	ArgoCDToken   string `env:"ARGOCD_TOKEN" doc:"Token the portal reads application state with. On the stand, mint one with make stand-token."`
	ArgoCDProject string `env:"ARGOCD_PROJECT" envDefault:"portal-managed" doc:"Argo CD project the portal's applications belong to."`
	ArgoCDCluster string `env:"ARGOCD_DEFAULT_CLUSTER" envDefault:"in-cluster" doc:"Cluster orders are deployed to unless they say otherwise."`
	// Includes the chart so two different charts ordered under the same service
	// name into one namespace do not collide on a single Application.
	ArgoCDAppNameTmpl string `env:"ARGOCD_APP_NAME_TEMPLATE" envDefault:"{{.Team}}-{{.Chart}}-{{.ServiceName}}" doc:"Template for the name of the generated Argo CD application. Knows the team, the chart and the service name."`
	// The chart repoURL in the committed application.yaml becomes
	// "{ChartRegistry}/{chart_project}", so this must be a host both the portal
	// and the Argo CD pods can resolve.
	ChartRegistry      string        `env:"CHART_REGISTRY" doc:"Registry the order manifest points at as the source of its chart. This is the Harbor OCI endpoint." example:"host.docker.internal:8084"`
	StatusUpdateMode   string        `env:"STATUS_UPDATE_MODE" envDefault:"hybrid" doc:"How the portal learns about changes: by polling with notifications on top, or by notifications alone."`
	StatusPollInterval time.Duration `env:"STATUS_POLL_INTERVAL" envDefault:"15s" doc:"How often the portal reconciles orders against GitLab and Argo CD. Raise it once notifications are wired."`
	DriftDetection     bool          `env:"DRIFT_DETECTION_ENABLED" envDefault:"true" doc:"Flag orders whose committed files were changed in Git outside the portal. Reads Git, never writes it."`
	// Off by default: it creates order rows.
	ImportDiscovery bool `env:"IMPORT_DISCOVERY_ENABLED" envDefault:"false" doc:"Adopt manifests created directly in Git, bypassing the portal, as imported orders."`
	// Off by default: it creates a publication row for every chart in the
	// scanned projects.
	CatalogAutodiscover bool `env:"CATALOG_AUTODISCOVER" envDefault:"false" doc:"Register charts found in the registry as draft publications, so they can be curated into the catalog."`

	DatabaseURL     string `env:"DATABASE_URL" doc:"Connection to the portal database. Required when the store is postgres." example:"postgres://portal:portal@localhost:5432/portal?sslmode=disable"`
	DatabaseMaxConn int32  `env:"DATABASE_MAX_CONNS" envDefault:"20" doc:"How many database connections may be open at once."`
	RedisURL        string `env:"REDIS_URL" doc:"Connection to the cache. Required when the cache is redis." example:"redis://localhost:6379/0"`

	LogLevel  string `env:"LOG_LEVEL" envDefault:"info" doc:"How much detail the log carries."`
	LogFormat string `env:"LOG_FORMAT" envDefault:"json" doc:"Log format: machine-readable json or readable text."`
}

// Load parses configuration from the process environment.
func Load() (*Config, error) {
	cfg := &Config{}
	if err := env.Parse(cfg); err != nil {
		return nil, err
	}
	switch cfg.StatusUpdateMode {
	case StatusModeHybrid, StatusModeWebhook:
	default:
		return nil, fmt.Errorf("STATUS_UPDATE_MODE must be %q or %q, got %q",
			StatusModeHybrid, StatusModeWebhook, cfg.StatusUpdateMode)
	}
	return cfg, nil
}
