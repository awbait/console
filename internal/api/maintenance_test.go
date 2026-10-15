package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"console/internal/maintenance"
	"console/internal/observability"
)

// Maintenance over HTTP: only admins set it; while it is on a member gets 503
// "maintenance" on the API but still reads who they are and the bell, an admin
// gets through, and the public health answer carries the window for the
// sign-in screen.
func TestHTTPMaintenance(t *testing.T) {
	srv, _, _ := newServer(t)
	srv.Maintenance = maintenance.New(srv.Store, nil, nil, false, observability.NewLogger("error", "text"))
	h := srv.Router()
	do := func(r *http.Request) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, r)
		return rec
	}

	if rec := do(httptest.NewRequest("GET", "/api/v1/platform/health", nil)); rec.Code != http.StatusOK ||
		jsonField(t, rec, "maintenance") != nil {
		t.Fatalf("no window, no field: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(devReq("PUT", "/api/v1/admin/maintenance", "core", map[string]any{})); rec.Code != http.StatusForbidden {
		t.Fatalf("member set: want 403, got %d", rec.Code)
	}
	rec := do(adminReq("PUT", "/api/v1/admin/maintenance", map[string]any{"auto_end": true}))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("auto end without end: want 422, got %d %s", rec.Code, rec.Body.String())
	}
	var bad struct {
		Details []struct{ Path, Message string } `json:"details"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &bad)
	if len(bad.Details) != 1 || bad.Details[0].Path != "auto_end" || bad.Details[0].Message != maintenance.CodeNeedsEnd {
		t.Fatalf("details: %s", rec.Body.String())
	}

	end := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	rec = do(adminReq("PUT", "/api/v1/admin/maintenance", map[string]any{"ends_at": end, "message": "DB upgrade"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("set: %d %s", rec.Code, rec.Body.String())
	}
	var view struct {
		Status  maintenance.Status `json:"status"`
		History []map[string]any   `json:"history"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &view)
	if view.Status.State != "active" || len(view.History) != 1 {
		t.Fatalf("view: %s", rec.Body.String())
	}

	rec = do(devReq("GET", "/api/v1/requests", "core", nil))
	if rec.Code != http.StatusServiceUnavailable || jsonField(t, rec, "error") != "maintenance" || rec.Header().Get("Retry-After") == "" {
		t.Fatalf("member during maintenance: %d %s", rec.Code, rec.Body.String())
	}
	for _, path := range []string{"/api/v1/auth/me", "/api/v1/notifications/unread", "/api/v1/info"} {
		if rec := do(devReq("GET", path, "core", nil)); rec.Code == http.StatusServiceUnavailable {
			t.Fatalf("%s must stay open: %d", path, rec.Code)
		}
	}
	if rec := do(adminReq("GET", "/api/v1/requests", nil)); rec.Code != http.StatusOK {
		t.Fatalf("admin during maintenance: %d %s", rec.Code, rec.Body.String())
	}
	rec = do(httptest.NewRequest("GET", "/api/v1/platform/health", nil))
	m, _ := jsonField(t, rec, "maintenance").(map[string]any)
	if m["state"] != "active" || m["message"] != "DB upgrade" || m["updated_by_name"] != nil {
		t.Fatalf("public health: %s", rec.Body.String())
	}

	if rec := do(adminReq("DELETE", "/api/v1/admin/maintenance", nil)); rec.Code != http.StatusOK {
		t.Fatalf("end: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(devReq("GET", "/api/v1/requests", "core", nil)); rec.Code != http.StatusOK {
		t.Fatalf("member after the end: %d", rec.Code)
	}
	if rec := do(adminReq("DELETE", "/api/v1/admin/maintenance", nil)); rec.Code != http.StatusNotFound {
		t.Fatalf("nothing to end: want 404, got %d", rec.Code)
	}
}

func jsonField(t *testing.T, rec *httptest.ResponseRecorder, key string) any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("decode %s: %v", rec.Body.String(), err)
	}
	return m[key]
}
