// Package config loads runtime configuration from the environment.
package config

import (
	"fmt"
	"strings"
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

// Webhook scopes (GITLAB_WEBHOOK_SCOPE) select where the portal registers its
// own merge-request webhook, which decides what that hook covers. Group and
// system hooks cover repositories created later on their own; project hooks are
// registered per repository, as it is created. The values mirror
// gitlab.HookScope, which is where the cascade lives.
const (
	WebhookScopeAuto    = "auto" // widest scope the instance allows
	WebhookScopeGroup   = "group"
	WebhookScopeSystem  = "system"
	WebhookScopeProject = "project"
)

// DefaultSessionSecret is the insecure development default for SESSION_SECRET.
// Keep it in sync with the envDefault tag below; buildAuth refuses to start in
// AUTH_MODE=oidc while the secret still equals this value.
const DefaultSessionSecret = "dev-insecure-session-secret-change-me"

// Config is the full portal configuration. Defaults favour a local
// fakes-only run so the whole portal boots with just Postgres+Redis
// (or fully in-memory in tests).
//
// Every field carries what it is for in its `desc` tag, and a sample value in
// `example` where the default cannot be one. That is the single source those
// sentences are written in: the root .env.example is generated from them (see
// envexample.go and `make env-example`), and a test fails if the file in the
// repository has drifted from what the tags say.
//
// A variable the portal cannot start without is marked `required,notEmpty` in
// the env tag itself, which is the loader's own option: it fails at startup
// with the variable named, before anything is connected to, and the generated
// example takes the same fact from the same place instead of restating it.
//
// There is no upstream "mode": the portal always talks to the real Harbor,
// GitLab and Argo CD, and refuses to start without their URLs and tokens. The
// in-memory fakes next to each client exist for tests only - a deployment that
// could switch to them by one environment variable is a deployment that can
// silently serve made-up charts.
type Config struct {
	// Server
	HTTPPort  string `env:"HTTP_PORT" envDefault:"8080" desc:"Port the portal serves its API and UI on."`
	PublicURL string `env:"PUBLIC_URL" envDefault:"http://localhost:8080" desc:"External address the portal is opened at."`
	// Its own listener, separate from the API port, so scraping is not exposed
	// through the public app ingress.
	MetricsPort string `env:"METRICS_PORT" envDefault:"2112" desc:"Separate port for Prometheus metrics, kept off the public ingress."`
	GrafanaURL  string `env:"GRAFANA_URL" desc:"Base address of Grafana. When set, the status page links to it; empty hides the link." example:"http://localhost:3000"`
	// Defaults to true: production runs over HTTPS, and localhost is a secure
	// context even on plain http.
	CookieSecure bool `env:"COOKIE_SECURE" envDefault:"true" desc:"Send the session cookie over HTTPS only. Turn it off only for a plain-HTTP stand that is not localhost."`

	Store string `env:"STORE" envDefault:"memory" desc:"Where orders, publications and categories are kept."`
	Cache string `env:"CACHE" envDefault:"memory" desc:"Where cached chart files are kept."`

	// AuthMode must be "oidc" (the only runtime mode). The no-Keycloak "dev" mode
	// is a test stub only and is rejected at startup.
	AuthMode       string        `env:"AUTH_MODE" envDefault:"oidc" desc:"How users sign in. There is one runtime mode: through the identity provider."`
	OIDCIssuer     string        `env:"OIDC_ISSUER" desc:"Realm address of the identity provider. Must match the issuer its tokens carry, which is host-sensitive." example:"http://localhost:8081/realms/internal"`
	OIDCClientID   string        `env:"OIDC_CLIENT_ID" desc:"Identifier of the portal as a client of the identity provider." example:"portal"`
	OIDCSecret     string        `env:"OIDC_CLIENT_SECRET" desc:"Secret of that client." example:"portal-secret"`
	OIDCRedirect   string        `env:"OIDC_REDIRECT_URL" desc:"Address the browser is returned to after signing in. Must be allowed in the realm." example:"http://localhost:8080/api/v1/auth/callback"`
	OIDCPostLogin  string        `env:"OIDC_POST_LOGIN_REDIRECT" envDefault:"/" desc:"Where the browser goes after a successful sign-in."`
	OIDCPostLogout string        `env:"OIDC_POST_LOGOUT_REDIRECT" desc:"Where the browser goes after signing out. Must be registered as a post-logout address on the client; empty reuses the sign-in one." example:"http://localhost:5173/"`
	OIDCScopes     []string      `env:"OIDC_SCOPES" envSeparator:"," envDefault:"openid,profile,email,groups" desc:"What the portal asks the identity provider about the user. Groups are what roles and teams are built from."`
	SessionSecret  string        `env:"SESSION_SECRET" envDefault:"dev-insecure-session-secret-change-me" desc:"Key the session is encrypted with. The portal refuses to start while it is still this one."`
	SessionCookie  string        `env:"SESSION_COOKIE_NAME" envDefault:"idp_session" desc:"Name of the cookie the session is kept in."`
	SessionTTL     time.Duration `env:"SESSION_TTL" envDefault:"24h" desc:"How long a session lives without signing in again."`

	AdminGroups     []string `env:"RBAC_ADMIN_GROUPS" envSeparator:"," desc:"Groups granting the platform administrator role. Empty means nobody has it." example:"platform-admins"`
	SupportGroups   []string `env:"RBAC_SUPPORT_GROUPS" envSeparator:"," desc:"Groups granting the support role: the orders of every team, without creating or deleting them." example:"support"`
	SecurityGroups  []string `env:"RBAC_SECURITY_GROUPS" envSeparator:"," desc:"Groups granting the information security role: the security section and policy orders." example:"security"`
	TeamGroupPrefix string   `env:"RBAC_TEAM_GROUP_PREFIX" envDefault:"team-" desc:"Prefix marking the groups a user's teams are taken from."`
	// Lets an external IdP with a different or nested group structure map to
	// teams without renaming its groups.
	TeamGroupRegex string `env:"RBAC_TEAM_GROUP_REGEX" desc:"Expression whose first capture group is the team name. When set it is used instead of the prefix." example:"(?:^|/)team-([^/]+)"`

	HarborURL         string        `env:"HARBOR_URL,required,notEmpty" desc:"Address of Harbor, without the API suffix." example:"https://host.docker.internal:8084"`
	HarborRobotUser   string        `env:"HARBOR_ROBOT_USER" desc:"Robot account the portal reads charts as. Empty reads them anonymously, which only works for public projects."`
	HarborRobotToken  string        `env:"HARBOR_ROBOT_TOKEN" desc:"Password of that robot account."`
	HarborProjects    []string      `env:"HARBOR_PROJECTS" envSeparator:"," envDefault:"platform,managed-services" desc:"Harbor projects the catalog is built from."`
	HarborWebhookKey  string        `env:"HARBOR_WEBHOOK_SECRET" desc:"Shared secret authenticating notifications from Harbor. Set the same value as the webhook auth header there; empty leaves the portal to find new charts by polling."`
	HarborInsecureTLS bool          `env:"HARBOR_INSECURE_TLS" envDefault:"false" desc:"Skip verification of the Harbor certificate. For stands with a self-signed one."`
	HarborTimeout     time.Duration `env:"HARBOR_TIMEOUT" envDefault:"30s" desc:"How long to wait for a Harbor response."`

	GitLabURL           string        `env:"GITLAB_URL,required,notEmpty" desc:"Address of GitLab." example:"http://localhost:8929"`
	GitLabToken         string        `env:"GITLAB_TOKEN,required,notEmpty" desc:"Token the portal creates repositories and merge requests with. Needs the api scope, and the Owner role on the GitOps group if it is to create team subgroups too." example:"glpat-localdev0123456789abcd"`
	GitLabTimeout       time.Duration `env:"GITLAB_TIMEOUT" envDefault:"30s" desc:"How long to wait for a GitLab response."`
	GitLabAutoMerge     bool          `env:"GITLAB_AUTO_MERGE" envDefault:"false" desc:"Merge the portal's own merge requests without waiting for a human. A service whose version asks for a review is merged by a person even so, and no service can merge itself where this is off."`
	GitLabGitopsGroup   string        `env:"GITLAB_GITOPS_GROUP" envDefault:"managed-services" desc:"Top-level group the GitOps repositories live in."`
	GitLabSubgroupTmpl  string        `env:"GITLAB_TEAM_SUBGROUP_TEMPLATE" envDefault:"team-{{.Team}}" desc:"Template for a team's subgroup path inside that group."`
	GitLabInstanceTmpl  string        `env:"GITLAB_INSTANCE_DIR_TEMPLATE" desc:"Template for the folder one ordered service gets inside its repository, under the cluster folder. Knows the team, the chart, the service name, the namespace and the cluster. Empty means the service name alone. It has to give every service of one team and chart its own folder, or two of them end up writing the same files. An order keeps the folder it was created in, so changing this only affects new orders." example:"{{.Namespace}}-{{.ServiceName}}"`
	GitLabCreateGroup   bool          `env:"GITLAB_CREATE_TEAM_SUBGROUP" envDefault:"true" desc:"Create a team's subgroup on the first order when it is missing. Turn it off where subgroups are provisioned elsewhere: then a team without one cannot order until somebody creates it. Creating a subgroup needs the token to own the top-level group."`
	GitLabDefaultBranch string        `env:"GITLAB_DEFAULT_BRANCH" envDefault:"main" desc:"Branch order changes are merged into and Argo CD tracks."`
	GitLabWebhookToken  string        `env:"GITLAB_WEBHOOK_TOKEN" desc:"Secret verifying notifications from GitLab. Set the same value as the webhook secret token there; empty leaves the portal to find merges by polling."`
	GitLabWebhookURL    string        `env:"GITLAB_WEBHOOK_URL" desc:"Address GitLab delivers notifications to, as seen from GitLab itself. Setting it lets the portal register the webhook on its own, including on repositories it creates later; empty means somebody registers it by hand." example:"http://host.docker.internal:8080/api/v1/webhooks/gitlab"`
	GitLabWebhookScope  string        `env:"GITLAB_WEBHOOK_SCOPE" envDefault:"auto" desc:"Where that webhook is registered: on the whole group (needs GitLab Premium), on the whole instance (needs an administrator token), on each repository, or whichever of those the instance allows."`

	ArgoCDURL     string `env:"ARGOCD_URL,required,notEmpty" desc:"Address of Argo CD." example:"http://localhost:8083"`
	ArgoCDToken   string `env:"ARGOCD_TOKEN,required,notEmpty" desc:"Token the portal reads application state with. On the stand, mint one with make stand-token."`
	ArgoCDProject string `env:"ARGOCD_PROJECT" envDefault:"portal-managed" desc:"Argo CD project the portal's applications belong to."`
	// ArgoCDNamespace is where the generated application.yaml puts the
	// Application CR. Argo CD reads Applications from its own namespace only, so
	// this has to be the namespace Argo CD itself runs in, whatever it is called.
	ArgoCDNamespace string `env:"ARGOCD_NAMESPACE" envDefault:"argocd" desc:"Namespace Argo CD runs in. The portal writes it into every application.yaml it commits, because Argo CD only picks up applications from its own namespace."`
	ArgoCDCluster string `env:"ARGOCD_DEFAULT_CLUSTER" envDefault:"in-cluster" desc:"Cluster orders are deployed to unless they say otherwise."`
	// Includes the chart so two different charts ordered under the same service
	// name into one namespace do not collide on a single Application.
	ArgoCDAppNameTmpl string `env:"ARGOCD_APP_NAME_TEMPLATE" envDefault:"{{.Team}}-{{.Chart}}-{{.ServiceName}}" desc:"Template for the name of the generated Argo CD application. Knows the team, the chart and the service name."`
	// The chart repoURL in the committed application.yaml becomes
	// "{ChartRegistry}/{chart_project}", so this must be a host both the portal
	// and the Argo CD pods can resolve.
	ChartRegistry      string        `env:"CHART_REGISTRY" desc:"Registry the order manifest points at as the source of its chart. This is the Harbor OCI endpoint." example:"host.docker.internal:8084"`
	StatusUpdateMode   string        `env:"STATUS_UPDATE_MODE" envDefault:"hybrid" desc:"How the portal learns about changes: by polling with notifications on top, or by notifications alone."`
	StatusPollInterval time.Duration `env:"STATUS_POLL_INTERVAL" envDefault:"15s" desc:"How often the portal reconciles orders against GitLab and Argo CD. Raise it once notifications are wired."`
	DriftDetection     bool          `env:"DRIFT_DETECTION_ENABLED" envDefault:"true" desc:"Flag orders whose committed files were changed in Git outside the portal. Reads Git, never writes it."`
	// Off by default: it creates order rows.
	ImportDiscovery bool `env:"IMPORT_DISCOVERY_ENABLED" envDefault:"false" desc:"Adopt manifests created directly in Git, bypassing the portal, as imported orders."`
	// Off by default: it creates a publication row for every chart in the
	// scanned projects.
	CatalogAutodiscover bool `env:"CATALOG_AUTODISCOVER" envDefault:"false" desc:"Register charts found in the registry as draft publications, so they can be curated into the catalog."`

	DatabaseURL     string `env:"DATABASE_URL" desc:"Connection to the portal database. Required when the store is postgres." example:"postgres://portal:portal@localhost:5432/portal?sslmode=disable"`
	DatabaseMaxConn int32  `env:"DATABASE_MAX_CONNS" envDefault:"20" desc:"How many database connections may be open at once."`
	RedisURL        string `env:"REDIS_URL" desc:"Connection to the cache. Required when the cache is redis." example:"redis://localhost:6379/0"`

	LogLevel  string `env:"LOG_LEVEL" envDefault:"info" desc:"How much detail the log carries."`
	LogFormat string `env:"LOG_FORMAT" envDefault:"json" desc:"Log format: machine-readable json or readable text."`
}

// Load parses configuration from the process environment.
func Load() (*Config, error) {
	cfg := &Config{}
	if err := env.Parse(cfg); err != nil {
		return nil, err
	}
	for _, v := range []struct{ name, value string }{
		{"STATUS_UPDATE_MODE", cfg.StatusUpdateMode},
		{"GITLAB_WEBHOOK_SCOPE", cfg.GitLabWebhookScope},
	} {
		if !allowed(v.name, v.value) {
			return nil, fmt.Errorf("%s must be one of %s, got %q",
				v.name, strings.Join(options[v.name], ", "), v.value)
		}
	}
	return cfg, nil
}
