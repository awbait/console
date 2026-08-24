// Command portal is the IDP backend entrypoint.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"regexp"
	"strings"
	"syscall"
	"time"

	"console/internal/activity"
	"console/internal/api"
	"console/internal/argocd"
	"console/internal/auth"
	"console/internal/buildinfo"
	"console/internal/cache"
	"console/internal/catalog"
	"console/internal/config"
	"console/internal/events"
	"console/internal/gitlab"
	"console/internal/harbor"
	"console/internal/notify"
	"console/internal/observability"
	"console/internal/provisioning"
	"console/internal/publications"
	"console/internal/status"
	"console/internal/store"
	"console/internal/webhooks"
	"console/pkg/models"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		// A misconfigured deployment is not a bug in the portal: it gets the
		// sentence naming what is missing, not a stack trace. The logger is not
		// up yet - its own settings come from the configuration that just
		// failed - so this goes straight to stderr.
		fmt.Fprintln(os.Stderr, "configuration:", err)
		os.Exit(1)
	}
	log := observability.NewLogger(cfg.LogLevel, cfg.LogFormat)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := run(ctx, cfg, log); err != nil {
		log.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, cfg *config.Config, log *slog.Logger) error {
	// --- cache ---
	var c cache.Cache
	switch cfg.Cache {
	case "redis":
		rc, err := cache.NewRedis(cfg.RedisURL)
		if err != nil {
			return err
		}
		c = rc
	default:
		c = cache.NewMemory()
	}
	defer c.Close()

	// --- store ---
	var st store.Store
	switch cfg.Store {
	case "postgres":
		pg, err := store.NewPostgres(ctx, cfg.DatabaseURL, cfg.DatabaseMaxConn)
		if err != nil {
			return err
		}
		st = pg
	default:
		st = store.NewMemory()
	}
	defer st.Close()

	// Bootstrap categories: only the system auto-discovery bucket (idempotent).
	// No publications are pre-seeded - services enter the catalog through
	// registration or auto-discovery + adoption.
	if err := store.SeedCategories(ctx, st); err != nil {
		return fmt.Errorf("seed categories: %w", err)
	}

	// --- upstreams ---
	// Always the real clients. The in-memory fakes live next to each client and
	// are used by tests only: a portal that can be pointed at a fake registry by
	// one environment variable is a portal that can silently serve made-up
	// charts in production.
	//
	// Their addresses and tokens are marked required in the config struct, so a
	// deployment missing one is refused by config.Load before this point - with
	// every missing variable named at once, and before the database has been
	// touched.
	if cfg.HarborInsecureTLS {
		// Legitimate for the local self-signed stand, dangerous in production
		// (disables cert verification, incl. the robot-cred Basic exchange).
		// Log loudly so it cannot leak into a real deployment unnoticed.
		log.Warn("HARBOR_INSECURE_TLS enabled: Harbor TLS verification is OFF (local stand only, never in production)")
	}
	hb := harbor.NewClient(cfg.HarborURL, cfg.HarborRobotUser, cfg.HarborRobotToken,
		cfg.HarborProjects, cfg.HarborInsecureTLS, cfg.HarborTimeout)

	gl := gitlab.NewClient(cfg.GitLabURL, cfg.GitLabToken, cfg.GitLabGitopsGroup, cfg.GitLabTimeout)

	argo := argocd.NewClient(cfg.ArgoCDURL, cfg.ArgoCDToken, cfg.GitLabTimeout)

	// --- domains ---
	gitops, err := provisioning.NewGitOps(cfg.GitLabGitopsGroup, cfg.GitLabSubgroupTmpl,
		cfg.ArgoCDAppNameTmpl, cfg.ArgoCDProject, cfg.GitLabDefaultBranch)
	if err != nil {
		return err
	}
	gitops.ChartRegistry = cfg.ChartRegistry  // OCI base for the chart source in application.yaml
	gitops.AppNamespace = cfg.ArgoCDNamespace // where Argo CD reads Applications from
	if err := gitops.SetInstanceTemplate(cfg.GitLabInstanceTmpl); err != nil {
		return err
	}
	bus := events.New()
	catalogSvc := catalog.New(hb, c)
	if cfg.GitLabAutoMerge {
		// The poller merges the portal's own MRs with no human review. Fine for
		// demos; dangerous against a real GitLab. Log loudly so it cannot enable
		// itself in production unnoticed.
		log.Warn("GITLAB_AUTO_MERGE enabled: portal MRs are merged without review")
	}
	provSvc := provisioning.New(st, gl, argo, catalogSvc, gitops, bus, cfg.ArgoCDCluster, cfg.GitLabDefaultBranch, cfg.GitLabAutoMerge)
	provSvc.Log = observability.Component(log, "provisioning")
	provSvc.CreateTeamSubgroup = cfg.GitLabCreateGroup
	// Self-registration of the inbound GitLab webhook. Both halves are needed: the
	// secret proves the delivery, the URL is where GitLab sends it. Registered
	// below, once; under the per-repository scope provSvc adds one to every repo
	// it creates.
	var hooks *gitlab.HookManager
	if cfg.GitLabWebhookURL != "" && cfg.GitLabWebhookToken != "" {
		hooks = gitlab.NewHookManager(gl, cfg.GitLabGitopsGroup, gitlab.Hook{
			URL:   cfg.GitLabWebhookURL,
			Token: cfg.GitLabWebhookToken,
			// GitLab only verifies a certificate for an https:// callback; asking it
			// to verify a plain http one is meaningless (and stands run http).
			SSLVerify: strings.HasPrefix(cfg.GitLabWebhookURL, "https://"),
		}, gitlab.HookScope(cfg.GitLabWebhookScope), observability.Component(log, "gitlab"))
		provSvc.Hooks = hooks
	}
	pubsSvc := publications.New(st, catalogSvc)
	pubsSvc.Log = observability.Component(log, "publications")
	// The admin group owning auto-discovered drafts; also bounds which
	// publications count as unclaimed for adoption.
	discoveryOwner := "platform-admins"
	if len(cfg.AdminGroups) > 0 {
		discoveryOwner = cfg.AdminGroups[0]
	}
	pubsSvc.SetDiscoveryOwner(discoveryOwner)

	// --- notifications ---
	// One writer for every domain that has something to tell a person. Wired
	// after the domains exist, so neither has to know how the other is built.
	notifySvc := notify.New(st, bus, observability.Component(log, "notify"))
	// What the admin group owns is addressed to the admin role: that group is
	// not a team and appears in nobody's team list.
	notifySvc.SetAdminTeam(discoveryOwner)
	provSvc.SetNotifier(notifySvc)
	pubsSvc.SetNotifier(notifySvc)
	// A new build of the portal is news for everyone, once per version: the
	// deduplication key is the version, so restarts and extra replicas stay
	// quiet.
	notifySvc.PortalUpdated(ctx, buildinfo.Get().Version)

	// --- auth ---
	// signIns remembers what the last successful login carried. Whether Keycloak
	// really sends the group claim is not something it will tell us; the only
	// evidence is a token it has issued (see internal/checks.KeycloakChecks).
	signIns := auth.NewSignIns()
	authn, err := buildAuth(ctx, cfg, c, observability.Component(log, "auth"), signIns)
	if err != nil {
		return err
	}

	// --- poller (single replica, in-process) ---
	reconcilers := []status.Reconciler{status.Named("provisioning", provSvc)} // advance order states
	if cfg.DriftDetection {
		reconcilers = append(reconcilers, status.Named("drift", driftReconciler{provSvc})) // flag Git-side drift
	}
	if cfg.ImportDiscovery {
		reconcilers = append(reconcilers, status.Named("import", importReconciler{provSvc})) // adopt Git-created apps
	}
	if cfg.CatalogAutodiscover {
		reconcilers = append(reconcilers, status.Named("catalog-discovery", discoveryReconciler{
			pubs: pubsSvc, cat: catalogSvc, ownerTeam: discoveryOwner,
			categoryID: publications.DefaultDiscoveryCategory,
		}))
	}
	// Owners hear about a release of their service they have not published yet.
	// Not tied to auto-discovery: that one registers charts nobody has claimed,
	// this one watches the ones that already have an owner.
	reconcilers = append(reconcilers, status.Named("chart-versions", chartVersionsReconciler{
		pubs: pubsSvc, cat: catalogSvc,
	}))
	// Notifications keep for 90 days once read; unread ones stay, however old.
	reconcilers = append(reconcilers, status.Named("notification-sweep", notifySweeper{notifySvc}))
	// In webhook-only mode the poller does not tick on its own (interval <= 0):
	// state advances solely on webhook-triggered sweeps, plus one startup sweep to
	// catch up after downtime. In hybrid the poll keeps running as a safety net.
	pollInterval := cfg.StatusPollInterval
	if cfg.StatusUpdateMode == config.StatusModeWebhook {
		pollInterval = 0
	}
	poller := status.NewPoller(pollInterval, observability.Component(log, "poller"), reconcilers...)
	pollerDone := make(chan struct{})
	go func() {
		defer close(pollerDone)
		poller.Run(ctx)
	}()

	// --- webhooks ---
	// Both modes accept inbound GitLab/Harbor webhooks that trigger an immediate
	// reconcile sweep. Routes register only for sources whose secret is set.
	webhookHandler := webhooks.New(poller, observability.Component(log, "webhooks"),
		cfg.GitLabWebhookToken, cfg.HarborWebhookKey)
	// Register the portal's own hook in GitLab (GITLAB_WEBHOOK_URL set), so no
	// human has to add it after a deploy. Whether a failure here is fatal depends
	// on the mode: in hybrid the poll still advances every order, in webhook-only
	// nothing else would.
	if scope, err := hooks.Ensure(ctx); err != nil {
		if cfg.StatusUpdateMode == config.StatusModeWebhook {
			return fmt.Errorf("register gitlab webhook: %w", err)
		}
		log.Warn("could not register the GitLab webhook, falling back to polling",
			"scope", cfg.GitLabWebhookScope, "err", err)
	} else if scope == gitlab.HookScopeProject {
		log.Info("gitlab webhook registered per repository",
			"note", "one hook per repo; the portal hooks each repo it creates from now on")
	}
	switch cfg.StatusUpdateMode {
	case config.StatusModeWebhook:
		// No poll backstop here: GitLab webhook is the only thing that advances the
		// order lifecycle, so a missing token would silently wedge every order.
		if !webhookHandler.GitLabEnabled() {
			return errors.New("STATUS_UPDATE_MODE=webhook requires GITLAB_WEBHOOK_TOKEN: " +
				"without it the order lifecycle never advances (no periodic poll)")
		}
		log.Warn("webhook-only status mode: periodic poll disabled; a missed or undelivered " +
			"webhook is NOT retried until restart - ensure reliable webhook delivery")
		if cfg.CatalogAutodiscover && !webhookHandler.HarborEnabled() {
			log.Warn("webhook-only status mode: HARBOR_WEBHOOK_SECRET not set; catalog autodiscovery " +
				"will only run on the startup sweep")
		}
	case config.StatusModeHybrid:
		if !webhookHandler.GitLabEnabled() {
			log.Warn("hybrid status mode: GitLab webhook disabled (GITLAB_WEBHOOK_TOKEN not set), polling only for GitLab")
		}
		if !webhookHandler.HarborEnabled() {
			log.Warn("hybrid status mode: Harbor webhook disabled (HARBOR_WEBHOOK_SECRET not set), polling only for Harbor")
		}
	}

	// --- activity ---
	// Who uses the portal. The directory builds itself from sign-ins: Keycloak
	// will not hand over its user list without a service account, and the people
	// who have never opened the portal are the least interesting part of the
	// answer anyway. Presence needs a cache that can order a set by time; both
	// backends can, so the assertion is a formality that keeps the Cache port
	// itself a plain blob store.
	presence, _ := c.(cache.Presence)
	if presence == nil {
		log.Warn("cache backend has no presence support: the portal will not know who is online")
	}
	activityRec := activity.New(st, c, presence, observability.Component(log, "activity"))

	// --- HTTP ---
	srv := &api.Server{
		Auth: authn, Catalog: catalogSvc, Prov: provSvc, Pubs: pubsSvc,
		Store: st, Cache: c, Bus: bus, Log: observability.Component(log, "api"), ArgoCDURL: cfg.ArgoCDURL,
		Harbor: hb, GitLab: gl, ArgoCD: argo, Reconcilers: poller, Webhooks: webhookHandler,
		Activity: activityRec,
		// Which groups grant a role rather than being a team. The interface
		// names such an owner by its role instead of printing the group path.
		RoleGroups: roleGroups(cfg),
		// The loaded config backs the admin configuration page (read-only).
		Config: cfg,
		System: api.SystemInfo{
			StoreBackend: backendName(cfg.Store, "postgres", "memory"),
			CacheBackend: backendName(cfg.Cache, "redis", "memory"),
			HarborURL:    cfg.HarborURL,
			GitLabURL:    cfg.GitLabURL,
			ArgoCDURL:    cfg.ArgoCDURL,
			AuthMode:     cfg.AuthMode,
			OIDCIssuer:   cfg.OIDCIssuer,
			GrafanaURL:   cfg.GrafanaURL,
		},
	}
	// Component health: one background monitor probes every upstream and storage
	// backend on the poll interval and keeps the result in memory. Both status
	// endpoints and the component gauges read that snapshot, so the number of
	// people looking at the portal never changes the load on the upstreams.
	health := srv.NewHealthMonitor(cfg.StatusPollInterval, observability.Component(log, "health"))
	srv.Health = health
	go health.Run(ctx)

	// Configuration checks: whether the portal is actually wired to the systems
	// it can reach. Far rarer than the health probes (see checks.Interval) and
	// read-only, so it can run against production; the one active check is
	// behind the admin's button and never on this loop.
	configChecks := buildChecks(cfg, hb, gl, argo, hooks, webhookHandler, signIns, health,
		observability.Component(log, "checks"))
	srv.Checks = configChecks
	srv.TestWebhookDelivery = webhookDeliveryTest(cfg, gl, hooks, webhookHandler)
	// Part of what these checks catch breaks with nobody touching the portal: a
	// token reaches its expiry, a webhook is switched off after failed
	// deliveries, a project is deleted. That is told to the platform team
	// instead of waiting on a page for somebody to open it.
	configChecks.SetAnnouncer(notifySvc.ConfigWatch())
	go configChecks.Run(ctx)

	// Refresh order gauges in-process (single replica), reusing the poller
	// interval. The metrics server below exposes the result.
	go srv.RunMetricsRefresher(ctx, cfg.StatusPollInterval)

	httpServer := &http.Server{
		Addr:              ":" + cfg.HTTPPort,
		Handler:           srv.Router(),
		ReadHeaderTimeout: 10 * time.Second,
		// Bound idle keep-alive connections and request header size. No global
		// WriteTimeout/ReadTimeout: SSE responses are long-lived (WriteTimeout
		// would cut them), and bodies are size-capped via MaxBytesReader instead.
		IdleTimeout:    120 * time.Second,
		MaxHeaderBytes: 1 << 20, // 1 MiB
	}

	// Prometheus /metrics on a dedicated listener, separate from the public API
	// port, so scraping stays internal-only (not exposed through the app ingress).
	metricsMux := http.NewServeMux()
	metricsMux.Handle("/metrics", api.MetricsHandler())
	metricsServer := &http.Server{
		Addr:              ":" + cfg.MetricsPort,
		Handler:           metricsMux,
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		if err := metricsServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("metrics server failed", "err", err)
		}
	}()

	go func() {
		<-ctx.Done()
		shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutCtx)
		_ = metricsServer.Shutdown(shutCtx)
	}()

	log.Info("portal starting",
		"port", cfg.HTTPPort, "metrics_port", cfg.MetricsPort, "auth", cfg.AuthMode,
		"store", cfg.Store, "cache", cfg.Cache,
		"harbor", cfg.HarborURL, "gitlab", cfg.GitLabURL, "argocd", cfg.ArgoCDURL)

	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	// Drain the poller: wait for its in-flight reconcile tick to unwind before
	// exiting, so we do not abandon a half-applied reconcile (e.g. a dangling
	// GitLab branch). Bounded so a stuck reconcile cannot hang shutdown.
	select {
	case <-pollerDone:
	case <-time.After(15 * time.Second):
		log.Warn("poller did not drain within shutdown grace")
	}
	return nil
}

// driftReconciler adapts Service.CheckDrift to the poller's status.Reconciler
// interface so drift detection runs alongside lifecycle reconciliation.
type driftReconciler struct{ s *provisioning.Service }

func (d driftReconciler) Reconcile(ctx context.Context) error { return d.s.CheckDrift(ctx) }

// notifySweeper drops notifications that have been read and are older than the
// retention window. It rides the poller rather than a timer of its own: there is
// exactly one background clock in the portal, and one more would be one more
// thing to reason about at shutdown.
type notifySweeper struct{ n *notify.Service }

func (s notifySweeper) Reconcile(ctx context.Context) error {
	return s.n.SweepRead(ctx, notificationRetention)
}

// How long a read notification is kept. Unread ones are never swept: nobody has
// seen them, so dropping one is losing the message rather than tidying up.
const notificationRetention = 90 * 24 * time.Hour

// importReconciler adapts Service.ImportFromGit to status.Reconciler so Git-side
// discovery runs on the poller.
type importReconciler struct{ s *provisioning.Service }

func (i importReconciler) Reconcile(ctx context.Context) error { return i.s.ImportFromGit(ctx) }

// chartVersionsReconciler tells owners about a release of their service that is
// in the registry but not published yet. It reads the same chart list discovery
// does - the catalog answers it from cache - and leaves the deciding to
// publications, which knows what "published" means.
type chartVersionsReconciler struct {
	pubs *publications.Service
	cat  *catalog.Service
}

func (c chartVersionsReconciler) Reconcile(ctx context.Context) error {
	charts, err := c.cat.ListCharts(ctx, &models.User{Role: models.RoleAdmin})
	if err != nil {
		return err
	}
	refs := make([]publications.ChartVersionRef, 0, len(charts))
	for _, ch := range charts {
		refs = append(refs, publications.ChartVersionRef{
			Project: ch.Project, Name: ch.Name, LatestVersion: ch.LatestVersion,
			Versions: ch.Versions,
		})
	}
	return c.pubs.NotifyNewVersions(ctx, refs)
}

// discoveryReconciler registers charts found in Harbor as draft publications
// (owner - the admin group). It pulls the chart list from the catalog
// (admin visibility - all), with the author taken from Chart.yaml.
type discoveryReconciler struct {
	pubs       *publications.Service
	cat        *catalog.Service
	ownerTeam  string
	categoryID string
}

func (d discoveryReconciler) Reconcile(ctx context.Context) error {
	charts, err := d.cat.ListCharts(ctx, &models.User{Role: models.RoleAdmin})
	if err != nil {
		return err
	}
	refs := make([]publications.DiscoveredChart, 0, len(charts))
	for _, c := range charts {
		refs = append(refs, publications.DiscoveredChart{Project: c.Project, Name: c.Name, Author: c.Author})
	}
	return d.pubs.EnsureDiscovered(ctx, refs, d.ownerTeam, d.categoryID)
}

// roleGroups maps every group that grants a role to that role. A group like
// this is not a team: it never lands in anybody's team list, but it can own a
// service, and the interface has to call such an owner by its role rather than
// print the group path at a person who has never seen it.
//
// Built from the same configuration the roles themselves come from, so the two
// cannot drift apart.
func roleGroups(cfg *config.Config) map[string]models.Role {
	out := map[string]models.Role{}
	for _, g := range cfg.AdminGroups {
		out[g] = models.RoleAdmin
	}
	for _, g := range cfg.SupportGroups {
		out[g] = models.RoleSupport
	}
	for _, g := range cfg.SecurityGroups {
		out[g] = models.RoleSecurity
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// backendName reports the effective backend for display on the status page:
// `match` when that's what was configured, otherwise the default `fallback`.
func backendName(configured, match, fallback string) string {
	if configured == match {
		return match
	}
	return fallback
}

func buildAuth(ctx context.Context, cfg *config.Config, c cache.Cache, log *slog.Logger, signIns *auth.SignIns) (auth.Authenticator, error) {
	// OIDC is the only runtime authenticator. The no-Keycloak Dev authenticator
	// (internal/auth/dev.go) is a test stub and is never wired into the binary.
	if cfg.AuthMode != "oidc" {
		return nil, fmt.Errorf("AUTH_MODE must be \"oidc\" (dev auth is test-only); got %q", cfg.AuthMode)
	}
	// Session values are encrypted with a key derived from SESSION_SECRET; the
	// insecure default would make that encryption pointless, so refuse to start.
	if cfg.SessionSecret == config.DefaultSessionSecret {
		return nil, fmt.Errorf("SESSION_SECRET must be set to a non-default value in AUTH_MODE=oidc")
	}
	sessions := auth.NewSessionStore(c, cfg.SessionTTL, cfg.SessionSecret)
	rbac := auth.RBAC{
		AdminGroups:    cfg.AdminGroups,
		SupportGroups:  cfg.SupportGroups,
		SecurityGroups: cfg.SecurityGroups,
		TeamPrefix:     cfg.TeamGroupPrefix,
	}
	if cfg.TeamGroupRegex != "" {
		re, err := regexp.Compile(cfg.TeamGroupRegex)
		if err != nil {
			return nil, fmt.Errorf("RBAC_TEAM_GROUP_REGEX: %w", err)
		}
		rbac.TeamRegex = re
	}
	o, err := auth.NewOIDC(ctx, auth.OIDCConfig{
		Issuer:       cfg.OIDCIssuer,
		ClientID:     cfg.OIDCClientID,
		ClientSecret: cfg.OIDCSecret,
		RedirectURL:  cfg.OIDCRedirect,
		Scopes:       cfg.OIDCScopes,
		CookieName:   cfg.SessionCookie,
		Secure:       cfg.CookieSecure,
		SessionTTL:   cfg.SessionTTL,
		PostLogin:    cfg.OIDCPostLogin,
		PostLogout:   cfg.OIDCPostLogout,
		Log:          log,
	}, sessions, rbac)
	if err != nil {
		return nil, err
	}
	o.SignIns = signIns
	return o, nil
}
