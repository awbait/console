package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"console/internal/api"
	"console/internal/status"
	"console/pkg/models"
)

// fixedHealth stands in for the background monitor with a snapshot the test
// controls.
type fixedHealth []status.ComponentState

func (f fixedHealth) Snapshot() []status.ComponentState { return f }

// capMap indexes a health payload by capability id.
func capMap(t *testing.T, body []byte) map[string]bool {
	t.Helper()
	var got api.PlatformHealth
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatalf("decode health: %v (%s)", err, body)
	}
	out := make(map[string]bool, len(got.Capabilities))
	for _, c := range got.Capabilities {
		out[c.ID] = c.OK
	}
	return out
}

// TestPlatformHealthIsPublic covers the reason the endpoint exists: the sign-in
// screen must learn whether signing in works before there is a session.
func TestPlatformHealthIsPublic(t *testing.T) {
	srv, _, _ := newServer(t)
	srv.Health = fixedHealth{
		{Name: "keycloak", Kind: "integration", Mode: "oidc", OK: false, Err: "dial tcp 10.0.0.5:8443: connect: connection refused"},
		{Name: "harbor", Kind: "integration", Mode: "real", OK: true},
		{Name: "gitlab", Kind: "integration", Mode: "real", OK: true},
		{Name: "argocd", Kind: "integration", Mode: "real", OK: true},
		{Name: "store", Kind: "storage", Mode: "postgres", OK: true},
		{Name: "cache", Kind: "storage", Mode: "redis", OK: true},
	}

	rec := httptest.NewRecorder()
	// No session, no dev headers: an anonymous browser on the login screen.
	srv.Router().ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/platform/health", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("platform health: %d body=%s", rec.Code, rec.Body.String())
	}

	caps := capMap(t, rec.Body.Bytes())
	if caps[status.CapSignIn] {
		t.Fatalf("sign_in reported working while keycloak is down: %s", rec.Body.String())
	}
	if !caps[status.CapOrders] {
		t.Fatalf("orders should be unaffected by keycloak: %s", rec.Body.String())
	}

	// Nothing about the platform's insides reaches an anonymous caller: no
	// component names, no modes, no probe errors.
	body := rec.Body.String()
	for _, leak := range []string{"keycloak", "harbor", "gitlab", "argocd", "postgres", "redis", "connection refused"} {
		if strings.Contains(strings.ToLower(body), leak) {
			t.Fatalf("public health leaked %q: %s", leak, body)
		}
	}
}

// TestPlatformHealthWithoutMonitor asserts the unwired case (tests, the moment
// before the first probe) reports a working platform rather than inventing an
// outage.
func TestPlatformHealthWithoutMonitor(t *testing.T) {
	srv, _, _ := newServer(t)
	rec := httptest.NewRecorder()
	srv.Router().ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/platform/health", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("platform health: %d", rec.Code)
	}
	var got api.PlatformHealth
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode health: %v", err)
	}
	if !got.Healthy || len(got.Capabilities) != len(status.Capabilities) {
		t.Fatalf("unwired monitor: %+v, want every capability OK", got)
	}
}

// TestPlatformHealthDegradedByHarbor pins the mapping a user actually sees when
// the registry is down: no catalog, no ordering, but the order list still works.
func TestPlatformHealthDegradedByHarbor(t *testing.T) {
	srv, _, _ := newServer(t)
	srv.Health = fixedHealth{
		{Name: "harbor", Kind: "integration", Mode: "real", OK: false, Err: "harbor: HTTP 502"},
		{Name: "gitlab", Kind: "integration", Mode: "real", OK: true},
		{Name: "store", Kind: "storage", Mode: "postgres", OK: true},
	}
	rec := httptest.NewRecorder()
	srv.Router().ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/platform/health", nil))

	caps := capMap(t, rec.Body.Bytes())
	for _, id := range []string{status.CapCatalog, status.CapOrdering, status.CapPublishing} {
		if caps[id] {
			t.Fatalf("%s reported working while harbor is down: %s", id, rec.Body.String())
		}
	}
	for _, id := range []string{status.CapOrders, status.CapDeployStatus, status.CapSignIn} {
		if !caps[id] {
			t.Fatalf("%s should be unaffected by harbor: %s", id, rec.Body.String())
		}
	}
}

// TestSystemStatusRestrictedToAdmin keeps component names and probe errors where
// they belong: the admin status page.
func TestSystemStatusRestrictedToAdmin(t *testing.T) {
	srv, _, _ := newServer(t)
	srv.Health = fixedHealth{
		{Name: "harbor", Kind: "integration", Mode: "real", OK: false, Err: "harbor: HTTP 502"},
	}
	h := srv.Router()

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, devReq("GET", "/api/v1/status", "core", nil))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("member status: %d, want 403", rec.Code)
	}

	r := devReq("GET", "/api/v1/status", "core", nil)
	r.Header.Set("X-Dev-Role", string(models.RoleAdmin))
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin status: %d body=%s", rec.Code, rec.Body.String())
	}
	var got api.SystemStatus
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if got.Healthy || len(got.Components) != 1 || got.Components[0].Detail != "harbor: HTTP 502" {
		t.Fatalf("admin status: %+v, want the failing component with its error", got)
	}
	if len(got.Capabilities) != len(status.Capabilities) {
		t.Fatalf("admin status carries %d capabilities, want %d", len(got.Capabilities), len(status.Capabilities))
	}
}
