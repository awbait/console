package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"console/pkg/models"
)

// Copying an order over HTTP: the draft comes back on the chosen stand, with
// the cluster named or the stand's default, and a reader of the team is
// refused.
func TestHTTPCopyRequest(t *testing.T) {
	srv, _, _ := newServer(t)
	h := srv.Router()
	do := func(r *http.Request) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, r)
		return rec
	}
	decode := func(t *testing.T, rec *httptest.ResponseRecorder, v any) {
		t.Helper()
		if err := json.Unmarshal(rec.Body.Bytes(), v); err != nil {
			t.Fatalf("decode %s: %v", rec.Body.String(), err)
		}
	}
	var dev, prod models.Stand
	rec := do(adminReq("POST", "/api/v1/stands", map[string]any{"name": "dev", "default_cluster": "in-cluster", "git_path": "managed-services"}))
	decode(t, rec, &dev)
	rec = do(adminReq("POST", "/api/v1/stands", map[string]any{"name": "prod", "default_cluster": "prod-a", "git_path": "managed-services/prod"}))
	decode(t, rec, &prod)

	rec = do(devReq("POST", "/api/v1/requests", "core", map[string]any{
		"chart": "platform/postgres", "version": "15.4.2", "team": "core", "service_name": "pg1",
		"stand_id": dev.ID, "draft": true,
		"values": map[string]any{"auth": map[string]any{"database": "app"}},
	}))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	var src models.Request
	decode(t, rec, &src)

	rec = do(devReq("POST", "/api/v1/requests/"+src.ID+"/copy", "core", map[string]any{"stand_id": prod.ID}))
	if rec.Code != http.StatusCreated {
		t.Fatalf("copy: %d %s", rec.Code, rec.Body.String())
	}
	var cp models.Request
	decode(t, rec, &cp)
	if cp.ID == src.ID || cp.StandID != prod.ID || cp.Cluster != "prod-a" || cp.Status != models.StatusDraft {
		t.Fatalf("copy: %+v", cp)
	}
	if rec := do(devReq("POST", "/api/v1/requests/"+src.ID+"/copy", "core", map[string]any{"stand_id": prod.ID, "cluster": "Bad Name"})); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("bad cluster: want 422, got %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(devReq("POST", "/api/v1/requests/"+src.ID+"/copy", "core", map[string]any{"stand_id": dev.ID})); rec.Code != http.StatusConflict {
		t.Fatalf("same name on the same cluster: want 409, got %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(devReq("POST", "/api/v1/requests/"+src.ID+"/copy", "other", map[string]any{"stand_id": prod.ID})); rec.Code != http.StatusForbidden && rec.Code != http.StatusNotFound {
		t.Fatalf("another team: want 403 or 404, got %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(devReq("POST", "/api/v1/requests/no-such/copy", "core", map[string]any{"stand_id": prod.ID})); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown order: want 404, got %d", rec.Code)
	}
}
