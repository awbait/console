package api

import (
	"context"
	"log/slog"
	"net/http"
	"sync/atomic"
	"time"

	"console/internal/activity"
	"console/internal/argocd"
	"console/internal/auth"
	"console/internal/cache"
	"console/internal/catalog"
	"console/internal/checks"
	"console/internal/config"
	"console/internal/events"
	"console/internal/gitlab"
	"console/internal/harbor"
	"console/internal/provisioning"
	"console/internal/publications"
	"console/internal/spa"
	"console/internal/store"
	"console/internal/webhooks"
	"console/pkg/models"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

const (
	// maxRequestBodyBytes caps a decoded request body to bound memory against a
	// hostile client (Values/View JSON are otherwise unbounded). SSE requests
	// carry no body, so this does not affect streams.
	maxRequestBodyBytes = 4 << 20 // 4 MiB
	// maxSSEStreams caps concurrent Server-Sent Events streams process-wide; each
	// holds a goroutine, a bus subscription and a socket until the client leaves.
	maxSSEStreams = 256
)

// Server holds dependencies for the HTTP API.
type Server struct {
	Auth    auth.Authenticator
	Catalog *catalog.Service
	Prov    *provisioning.Service
	Pubs    *publications.Service
	Store   store.Store
	Cache   cache.Cache
	Bus     events.Bus
	Log     *slog.Logger
	// ArgoCDURL is the ArgoCD UI base (ARGOCD_URL); empty when not configured
	// (e.g. fake mode). Used to build per-app deep links in the request detail.
	ArgoCDURL string

	// RoleGroups maps a group that grants a role (RBAC_ADMIN_GROUPS and its
	// support/security counterparts) to that role, and travels to the SPA in
	// GET /auth/me. Such a group is not a team, but it can own a service, so
	// the interface has to know which owner names are groups to be called by
	// their role. Optional: empty leaves every owner printed as stored.
	RoleGroups map[string]models.Role

	// Upstream ports + their configured modes, used by the system status page
	// (GET /api/v1/status) to probe and report integration health.
	Harbor harbor.Port
	GitLab gitlab.Port
	ArgoCD argocd.Port
	System SystemInfo

	// Reconcilers exposes the background poller's per-loop health to the status
	// page (GET /api/v1/status). Optional: nil omits the reconcilers section.
	Reconcilers reconcilerSnapshotter

	// Leader reports whether this replica is the one running the background
	// loops (see internal/leader), so the status page can say that an empty
	// list of loops means "another replica has them" rather than "none run".
	// Optional: nil answers yes, which is the truth of a single replica.
	Leader func() bool

	// Config is the loaded runtime configuration, served read-only on the admin
	// configuration page (GET /api/v1/config). Optional: nil answers 503 there
	// and changes nothing else.
	Config *config.Config

	// Health is the background component monitor behind both status endpoints
	// (GET /api/v1/platform/health and GET /api/v1/status). Build it with
	// NewHealthMonitor once the ports above are set. Optional: nil reports
	// everything as working, which is what tests want.
	Health healthMonitor

	// Checks is the background configuration-check runner behind
	// GET /api/v1/status/checks: what is wired up, as opposed to what answers a
	// ping. Optional: nil serves an empty set and changes nothing else.
	Checks checksSnapshotter

	// TestWebhookDelivery asks GitLab to deliver a sample event to the portal and
	// reports whether it arrived (see internal/checks.TestGitLabDelivery). A
	// function rather than a port: it is one call, wired in cmd/portal where the
	// GitLab client and the hook manager both exist. Optional: nil answers 503.
	TestWebhookDelivery func(context.Context) checks.DeliveryTest

	// Activity records who uses the portal (presence in the cache, the sign-in
	// directory in the store) and reads that back for the admin activity page.
	// Optional: nil records nothing and answers 503 on those endpoints.
	Activity *activity.Recorder

	// Webhooks handles inbound upstream webhooks (GitLab MR, Harbor push). Routes
	// register per-source only when that source's secret is set; nil omits them
	// entirely (e.g. tests).
	Webhooks *webhooks.Handler

	// sseStreams counts live SSE streams to enforce maxSSEStreams (zero value is
	// ready to use; no constructor needed).
	sseStreams atomic.Int64
}

// MetricsHandler returns the Prometheus /metrics handler. It is served on a
// dedicated listener (see cmd/portal), separate from the API, so scraping is not
// reachable through the public app ingress.
func MetricsHandler() http.Handler {
	return promhttp.Handler()
}

// Router builds the HTTP handler tree.
func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Recoverer)
	r.Use(s.requestLogger)

	// public
	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	r.Get("/ready", s.handleReady)
	// /metrics is served on a separate listener (see MetricsHandler), not here.

	r.Route("/api/v1", func(r chi.Router) {
		r.Use(maxBytes(maxRequestBodyBytes)) // bound request-body memory (GET/SSE carry none)

		// Platform health (unauthenticated): which portal capabilities work right
		// now. The sign-in screen needs it before there is a session, and it only
		// ever answers in capabilities - never component names or probe errors.
		r.Get("/platform/health", s.handlePlatformHealth)

		// auth endpoints (unauthenticated)
		r.Get("/auth/login", s.Auth.Login)
		r.Get("/auth/callback", s.Auth.Callback)
		r.Get("/auth/logout", s.Auth.Logout)

		// upstream webhooks (machine-to-machine, authenticated by a shared secret
		// in-handler, not by session): registered only for sources whose secret
		// is configured.
		if s.Webhooks != nil {
			if s.Webhooks.GitLabEnabled() {
				r.Post("/webhooks/gitlab", s.Webhooks.GitLab)
			}
			if s.Webhooks.HarborEnabled() {
				r.Post("/webhooks/harbor", s.Webhooks.Harbor)
			}
		}

		// authenticated
		r.Group(func(r chi.Router) {
			r.Use(auth.Middleware(s.Auth))
			// Note that this person is around. After the authenticator, which is
			// where the user comes from, and before everything else: the record is
			// of a request arriving, not of it succeeding.
			if s.Activity != nil {
				r.Use(s.Activity.Middleware)
			}

			r.Get("/auth/me", s.handleMe)

			// portal version + changelog ("About" page); informational, any role
			r.Get("/info", s.handleAbout)
			r.Get("/changelog", s.handleChangelog)

			// system status (integrations + storage health)
			r.Get("/status", s.handleSystemStatus)
			// configuration checks: what is actually wired up (admin). Its own
			// endpoint, on its own refresh rhythm - see internal/api/checks.go.
			r.Get("/status/checks", s.handleStatusChecks)
			r.Post("/status/checks/run", s.handleRunStatusChecks)
			r.Post("/status/checks/webhook-delivery", s.handleTestWebhookDelivery)
			// runtime configuration, read-only (admin)
			r.Get("/config", s.handleConfig)
			// who uses the portal (admin): the sign-in directory, the teams it
			// adds up to, and what people have been doing. The trends themselves
			// are in Grafana - see internal/api/handlers_users.go.
			r.Get("/admin/users", s.handleUsers)
			r.Get("/admin/users/online", s.handleUsersOnline)
			r.Get("/admin/users/events", s.handleUserEvents)
			// The teams the portal has seen, for the owner selector (admin only).
			r.Get("/teams", s.handleListTeams)

			// catalog
			r.Get("/charts", s.handleListCharts)
			r.Post("/charts/check", s.handleCheckChart) // check a chart at an arbitrary path
			r.Get("/charts/{project}/{name}", s.handleGetChart)
			r.Get("/charts/{project}/{name}/changelog/aggregated", s.handleAggregatedChangelog)
			r.Get("/charts/{project}/{name}/view", s.handleGetChartView)    // active approved view (static wins over {version})
			r.Get("/charts/{project}/{name}/initial", s.handleOrderInitial) // values a new order form opens with
			r.Get("/view-refs", s.handleViewRefs)                           // what a document may reference in defaults/initial
			r.Get("/charts/{project}/{name}/{version}", s.handleGetVersion)
			r.Get("/charts/{project}/{name}/{version}/values", s.handleGetValues)
			r.Get("/charts/{project}/{name}/{version}/readme", s.handleGetReadme)
			r.Get("/charts/{project}/{name}/{version}/changelog", s.handleGetChangelog)
			r.Get("/charts/{project}/{name}/{version}/schema", s.handleGetSchema)

			// catalog metadata: categories + publications over the Harbor listing
			r.Get("/catalog", s.handleCatalog)
			r.Get("/categories", s.handleListCategories)
			r.Post("/categories", s.handleCreateCategory)        // admin
			r.Patch("/categories/{id}", s.handleUpdateCategory)  // admin
			r.Delete("/categories/{id}", s.handleDeleteCategory) // admin

			// platform variables: named values a version document references as
			// "{{.Vars.OPS}}". Reading is open (the constructor offers them),
			// writing is admin.
			r.Get("/variables", s.handleListVariables)
			r.Get("/variables/{name}/usage", s.handleVariableUsage)
			r.Put("/variables/{name}", s.handleSetVariable)       // admin
			r.Post("/variables", s.handleSetVariable)             // admin
			r.Delete("/variables/{name}", s.handleDeleteVariable) // admin

			// chart publications: metadata + view builder + approval
			r.Get("/view-schema", s.handleViewSchema) // format of the view document, for the constructor's editor
			r.Get("/publications", s.handleListPublications)
			r.Post("/publications", s.handleCreatePublication)
			r.Get("/publications/{id}", s.handleGetPublication)
			r.Patch("/publications/{id}", s.handlePatchPublication)
			r.Post("/publications/{id}/adopt", s.handleAdoptPublication) // claim an auto-discovered draft
			r.Post("/publications/{id}/submit", s.handleSubmitPublication)
			r.Post("/publications/{id}/withdraw", s.handleWithdrawPublication) // withdraw from approval
			r.Post("/publications/{id}/approve", s.handleApprovePublication)   // admin
			r.Post("/publications/{id}/reject", s.handleRejectPublication)     // admin

			// per-version view builder + approval FSM (multi-version publications)
			r.Get("/publications/pending-versions", s.handlePendingVersions) // admin queue (static path wins over /{id})
			r.Get("/publications/{id}/versions", s.handleListVersions)
			r.Put("/publications/{id}/versions/{version}", s.handleSaveVersionView)
			r.Post("/publications/{id}/versions/{version}/validate", s.handleValidateVersion)
			r.Post("/publications/{id}/versions/{version}/submit", s.handleSubmitVersion)
			r.Post("/publications/{id}/versions/{version}/withdraw", s.handleWithdrawVersion)
			r.Post("/publications/{id}/versions/{version}/approve", s.handleApproveVersion) // admin
			r.Post("/publications/{id}/versions/{version}/reject", s.handleRejectVersion)   // admin
			r.Post("/publications/{id}/versions/{version}/orderable", s.handleSetVersionOrderable)
			// Support: taking a version out of it is the owner's own decision, so it
			// sits beside the allowlist rather than in the approval routes above.
			r.Post("/publications/{id}/versions/{version}/deprecate", s.handleDeprecateVersion)
			r.Post("/publications/{id}/versions/{version}/undeprecate", s.handleUndeprecateVersion)
			r.Post("/publications/{id}/recommended", s.handleSetRecommendedVersion)

			// requests
			r.Get("/requests", s.handleListRequests)
			r.Post("/requests", s.handleCreateRequest)
			r.Get("/requests/events", s.handleAllRequestEvents) // global stream for lists (static path wins over /{id})
			r.Get("/requests/{id}", s.handleGetRequest)
			// The view document of the version THIS order runs, which outlives the
			// version's place in the catalog (see handleGetRequestView).
			r.Get("/requests/{id}/view", s.handleGetRequestView)
			r.Patch("/requests/{id}", s.handlePatchRequest)
			r.Delete("/requests/{id}", s.handleDeleteRequest)
			r.Post("/requests/{id}/rename", s.handleRenameRequest)
			r.Post("/requests/{id}/submit", s.handleSubmitRequest)
			r.Post("/requests/{id}/sync", s.handleSyncRequest)
			r.Post("/requests/{id}/pull", s.handlePullRequest) // adopt Git state into the portal
			r.Get("/requests/{id}/events", s.handleRequestEvents)

			// notifications: the reader's own feed (audience comes from the session)
			r.Get("/notifications", s.handleListNotifications)
			r.Get("/notifications/unread", s.handleUnreadNotifications)
			r.Get("/notifications/events", s.handleNotificationEvents) // signal only, no content
			r.Post("/notifications/read-all", s.handleReadAllNotifications)
			r.Post("/notifications/{id}/read", s.handleReadNotification)
		})
	})

	// SPA: serve the embedded frontend for everything not matched above (assets +
	// client-side routes). Registered last so /health, /metrics and /api win.
	if dist, err := spa.FS(); err != nil {
		s.logger().Error("spa assets unavailable", "err", err)
	} else if h, herr := spaHandler(dist); herr != nil {
		s.logger().Error("spa handler init failed", "err", herr)
	} else {
		r.Handle("/*", h)
	}

	return r
}

// maxBytes wraps each request body in http.MaxBytesReader so a handler cannot
// read more than n bytes, bounding memory from a hostile client. Requests
// without a body (GET, SSE) are unaffected.
func maxBytes(n int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Body != nil {
				r.Body = http.MaxBytesReader(w, r.Body, n)
			}
			next.ServeHTTP(w, r)
		})
	}
}

// logger returns the configured logger, or the default if none was wired (tests).
func (s *Server) logger() *slog.Logger {
	if s.Log != nil {
		return s.Log
	}
	return slog.Default()
}

// requestLogger logs one line per HTTP request with method, path, status, size
// and latency. Liveness/scrape endpoints (/health, /ready, /metrics) log at
// debug so routine polling does not drown the log; everything else logs at info.
func (s *Server) requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		start := time.Now()
		next.ServeHTTP(ww, r)

		// A request that just failed against an upstream is better evidence than
		// any schedule: ask the monitor to probe now, so the portal admits the
		// outage while the user is still looking at it instead of on the next
		// poll. The monitor coalesces and throttles these, so a burst of failures
		// costs one probe round.
		if ww.Status() == http.StatusBadGateway && s.Health != nil {
			s.Health.Trigger("upstream request failed")
		}

		level := slog.LevelInfo
		switch r.URL.Path {
		case "/health", "/ready":
			level = slog.LevelDebug
		}
		s.logger().LogAttrs(r.Context(), level, "http request",
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.Int("status", ww.Status()),
			slog.Int("bytes", ww.BytesWritten()),
			slog.Int64("duration_ms", time.Since(start).Milliseconds()),
			slog.String("request_id", middleware.GetReqID(r.Context())),
		)
	})
}

func (s *Server) handleReady(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	// /ready is public (pre-auth); log the upstream detail but return a generic
	// message so host/port/driver internals are not exposed to anonymous callers.
	if err := s.Store.Ping(ctx); err != nil {
		s.logger().LogAttrs(ctx, slog.LevelWarn, "readiness check failed",
			slog.String("component", "store"), slog.String("err", err.Error()))
		writeErr(w, http.StatusServiceUnavailable, "not_ready", "store unavailable")
		return
	}
	if err := s.Cache.Ping(ctx); err != nil {
		s.logger().LogAttrs(ctx, slog.LevelWarn, "readiness check failed",
			slog.String("component", "cache"), slog.String("err", err.Error()))
		writeErr(w, http.StatusServiceUnavailable, "not_ready", "cache unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

// meResponse is the session, plus the one piece of configuration the interface
// needs in order to name things: which groups grant a role rather than being a
// team. A group like "idp_ecpk_console/admin" can own a service, and printing
// its path tells the reader nothing - it is "Администратор платформы" they know
// from the profile menu. What that reads as is the interface's business, so the
// portal sends the role and the wording stays in the SPA.
//
// Empty when nothing is wired (tests, dev): the interface then prints the group
// as it is, which is what it did before.
type meResponse struct {
	*models.User
	RoleGroups map[string]models.Role `json:"role_groups,omitempty"`
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, meResponse{
		User:       auth.UserFrom(r.Context()),
		RoleGroups: s.RoleGroups,
	})
}
