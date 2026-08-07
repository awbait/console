package api

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"console/internal/auth"
	"console/internal/status"
)

// SystemInfo carries the configured backend modes + external UI URLs for the
// status page. It is set once at wiring time (main.go) and is purely descriptive.
type SystemInfo struct {
	HarborMode   string // fake|real
	GitLabMode   string // fake|real
	ArgoCDMode   string // fake|real
	StoreBackend string // memory|postgres
	CacheBackend string // memory|redis
	HarborURL    string // external UI link (empty in fake mode)
	GitLabURL    string
	ArgoCDURL    string
	AuthMode     string // oidc|dev
	OIDCIssuer   string // Keycloak issuer (empty in dev mode)
	GrafanaURL   string // external Grafana base for the "view in Grafana" link (optional)
}

// ComponentStatus is one row on the system status page.
type ComponentStatus struct {
	Name   string `json:"name"`             // harbor|gitlab|argocd|store|cache
	Kind   string `json:"kind"`             // "integration" | "storage"
	Mode   string `json:"mode"`             // integration: fake|real; storage: backend
	Status string `json:"status"`           // "ok" | "error"
	Detail string `json:"detail,omitempty"` // error message when status != ok
	URL    string `json:"url,omitempty"`    // external UI link (integrations only)
}

// ReconcilerStatus is one background-loop row on the status page. Deep metrics
// (durations, history) live in Grafana; this is just a liveness traffic light.
type ReconcilerStatus struct {
	Name        string `json:"name"`                   // provisioning|drift|import|...
	Status      string `json:"status"`                 // "ok" | "failing"
	LastSuccess string `json:"last_success,omitempty"` // RFC3339; empty if never succeeded
	LastError   string `json:"last_error,omitempty"`   // last error message when failing
	LastRunMs   int64  `json:"last_run_ms,omitempty"`  // duration of the last run
}

// reconcilerSnapshotter is the slice of the poller the status page needs: the
// current health of each background reconciler.
type reconcilerSnapshotter interface {
	Snapshot() []status.ReconcilerState
}

// healthSnapshotter is the slice of the health monitor both status endpoints
// need: the last probe result for every component.
type healthSnapshotter interface {
	Snapshot() []status.ComponentState
}

// SystemStatus is the aggregate health payload returned by GET /api/v1/status.
type SystemStatus struct {
	Healthy      bool                     `json:"healthy"`
	Components   []ComponentStatus        `json:"components"`
	Capabilities []status.CapabilityState `json:"capabilities"`
	Reconcilers  []ReconcilerStatus       `json:"reconcilers,omitempty"`
	GrafanaURL   string                   `json:"grafana_url,omitempty"`
}

// PlatformHealth is the payload of GET /api/v1/platform/health: what the portal
// can and cannot do right now, in the portal's own terms.
//
// It is unauthenticated on purpose - the sign-in screen has to know whether
// signing in works at all - so it carries no component names, no modes, no URLs
// and no probe errors. Anyone who may see those already has the admin status
// page.
type PlatformHealth struct {
	Healthy      bool                     `json:"healthy"`
	Capabilities []status.CapabilityState `json:"capabilities"`
}

// probes builds the check set for every integration (Harbor/GitLab/ArgoCD via
// Healthz, Keycloak via its discovery doc) and storage backend (store/cache via
// Ping). The health monitor runs them on an interval; nothing probes an upstream
// per request.
func (s *Server) probes() []status.Probe {
	// Keycloak: in oidc mode hit the issuer's discovery doc (validates reachability);
	// in dev mode there is no external IdP, so report ok with mode "dev".
	authProbe := func(ctx context.Context) error {
		if s.System.AuthMode != "oidc" {
			return nil
		}
		url := strings.TrimRight(s.System.OIDCIssuer, "/") + "/.well-known/openid-configuration"
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return err
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("keycloak discovery %s: HTTP %d", url, resp.StatusCode)
		}
		return nil
	}
	return []status.Probe{
		{Name: "keycloak", Kind: "integration", Mode: s.System.AuthMode, URL: issuerBase(s.System.OIDCIssuer), Check: authProbe},
		{Name: "harbor", Kind: "integration", Mode: s.System.HarborMode, URL: s.System.HarborURL, Check: s.Harbor.Healthz},
		{Name: "gitlab", Kind: "integration", Mode: s.System.GitLabMode, URL: s.System.GitLabURL, Check: s.GitLab.Healthz},
		{Name: "argocd", Kind: "integration", Mode: s.System.ArgoCDMode, URL: s.System.ArgoCDURL, Check: s.ArgoCD.Healthz},
		{Name: "store", Kind: "storage", Mode: s.System.StoreBackend, Check: s.Store.Ping},
		{Name: "cache", Kind: "storage", Mode: s.System.CacheBackend, Check: s.Cache.Ping},
	}
}

// NewHealthMonitor builds the monitor over this server's probes. main wires it
// back into Server.Health and runs it.
func (s *Server) NewHealthMonitor(interval time.Duration, log *slog.Logger) *status.Monitor {
	return status.NewMonitor(interval, log, s.probes()...)
}

// handlePlatformHealth reports which portal capabilities work right now. Public
// and cheap: it reads the monitor's in-memory snapshot, so hammering it costs
// the upstreams nothing. Always 200 - "the platform is degraded" is an answer,
// not a failure.
func (s *Server) handlePlatformHealth(w http.ResponseWriter, _ *http.Request) {
	caps := status.Evaluate(s.componentStates())
	writeJSON(w, http.StatusOK, PlatformHealth{Healthy: status.AllOK(caps), Capabilities: caps})
}

// handleSystemStatus reports the health of every integration and storage backend
// plus the background loops. Always returns 200 - the body's `healthy` flag
// carries the verdict so the page can render partial failures rather than
// erroring out.
func (s *Server) handleSystemStatus(w http.ResponseWriter, r *http.Request) {
	// System status is a platform-admin tool (integration health, storage backends).
	if u := auth.UserFrom(r.Context()); u == nil || !u.IsAdmin() {
		writeErr(w, http.StatusForbidden, "forbidden", "system status is restricted to platform admins")
		return
	}
	states := s.componentStates()
	comps := make([]ComponentStatus, 0, len(states))
	healthy := true
	for _, st := range states {
		c := ComponentStatus{Name: st.Name, Kind: st.Kind, Mode: st.Mode, URL: st.URL, Status: "ok"}
		if !st.OK {
			c.Status = "error"
			c.Detail = st.Err
			healthy = false
		}
		comps = append(comps, c)
	}
	writeJSON(w, http.StatusOK, SystemStatus{
		Healthy:      healthy,
		Components:   comps,
		Capabilities: status.Evaluate(states),
		Reconcilers:  s.reconcilerStatuses(),
		GrafanaURL:   s.System.GrafanaURL,
	})
}

// componentStates returns the monitor's snapshot, or nil when no monitor is
// wired (tests): with no probe results everything reads as working, which is the
// right default for a page that must never invent an outage.
func (s *Server) componentStates() []status.ComponentState {
	if s.Health == nil {
		return nil
	}
	return s.Health.Snapshot()
}

// reconcilerStatuses maps the poller snapshot into the status-page shape. Returns
// nil when no poller is wired (e.g. in tests), so the field is omitted.
func (s *Server) reconcilerStatuses() []ReconcilerStatus {
	if s.Reconcilers == nil {
		return nil
	}
	states := s.Reconcilers.Snapshot()
	out := make([]ReconcilerStatus, 0, len(states))
	for _, st := range states {
		rs := ReconcilerStatus{Name: st.Name, LastRunMs: st.LastRunMs}
		if st.Failing {
			rs.Status = "failing"
			rs.LastError = st.LastErr
		} else {
			rs.Status = "ok"
		}
		if !st.LastSuccess.IsZero() {
			rs.LastSuccess = st.LastSuccess.Format(time.RFC3339)
		}
		out = append(out, rs)
	}
	return out
}

// issuerBase strips the Keycloak realm suffix ("…/realms/<name>") from the OIDC
// issuer so the status page links to the IdP root, not the realm endpoint.
func issuerBase(issuer string) string {
	base, _, _ := strings.Cut(issuer, "/realms/")
	return base
}
