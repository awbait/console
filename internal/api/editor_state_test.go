package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"console/pkg/models"
)

// TestHTTPEditorStateRoundTrip walks the wire: a draft created with editor
// state returns it on a single-order read, a PATCH without one leaves it alone,
// and the orders list stays free of it.
func TestHTTPEditorStateRoundTrip(t *testing.T) {
	srv, _, _ := newServer(t)
	h := srv.Router()
	state := map[string]any{
		"profile": "policies",
		"version": 1,
		"data": map[string]any{
			"orderNs":   "shop-core",
			"topology":  []any{map[string]any{"name": "shop-core", "workloads": []any{}}},
			"positions": map[string]any{"shop-core": map[string]any{"x": 10, "y": 20}},
		},
	}
	values := map[string]any{"auth": map[string]any{"database": "app"}}

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, devReq("POST", "/api/v1/requests", "core", map[string]any{
		"chart": "platform/postgres", "version": "15.4.2", "team": "core",
		"service_name": "pg1", "values": values, "editor_state": state, "draft": true,
	}))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d body=%s", rec.Code, rec.Body.String())
	}
	var created models.Request
	_ = json.Unmarshal(rec.Body.Bytes(), &created)

	get := func() models.Request {
		t.Helper()
		r := httptest.NewRecorder()
		h.ServeHTTP(r, devReq("GET", "/api/v1/requests/"+created.ID, "core", nil))
		if r.Code != http.StatusOK {
			t.Fatalf("get: %d body=%s", r.Code, r.Body.String())
		}
		var detail struct {
			Request models.Request `json:"request"`
		}
		_ = json.Unmarshal(r.Body.Bytes(), &detail)
		return detail.Request
	}

	var got map[string]any
	if err := json.Unmarshal(get().EditorState, &got); err != nil {
		t.Fatalf("editor state not returned: %v", err)
	}
	if got["profile"] != "policies" {
		t.Fatalf("editor state mangled: %v", got)
	}

	// A PATCH from the plain form carries no editor state and must not drop it.
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, devReq("PATCH", "/api/v1/requests/"+created.ID, "core", map[string]any{
		"values": values,
	}))
	if rec.Code != http.StatusOK {
		t.Fatalf("patch: %d body=%s", rec.Code, rec.Body.String())
	}
	if len(get().EditorState) == 0 {
		t.Fatal("editor state dropped by a patch that did not send one")
	}

	// The list is the hot path and leaves the state out.
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, devReq("GET", "/api/v1/requests", "core", nil))
	var list []models.Request
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	if len(list) != 1 {
		t.Fatalf("want 1 order, got %d", len(list))
	}
	if len(list[0].EditorState) != 0 {
		t.Fatalf("list carried the editor state: %s", list[0].EditorState)
	}
}
