package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"console/pkg/models"
)

// A variable's own value on a stand over HTTP: admins write it, the variable
// comes back whole, an empty value clears it, and the list carries it.
func TestHTTPVariableOverrides(t *testing.T) {
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

	rec := do(adminReq("POST", "/api/v1/stands", map[string]any{"name": "prod", "default_cluster": "prod-a"}))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create stand: %d %s", rec.Code, rec.Body.String())
	}
	var prod models.Stand
	decode(t, rec, &prod)
	if rec := do(adminReq("PUT", "/api/v1/variables/OPS_DOMAIN", map[string]any{"value": "dev.example.com"})); rec.Code != http.StatusOK {
		t.Fatalf("create variable: %d %s", rec.Code, rec.Body.String())
	}

	// A list row always carries the field, empty or not: the page iterates it.
	rec = do(devReq("GET", "/api/v1/variables", "core", nil))
	var list []map[string]any
	decode(t, rec, &list)
	if len(list) != 1 || list[0]["overrides"] == nil {
		t.Fatalf("list must carry overrides: %s", rec.Body.String())
	}

	override := "/api/v1/variables/OPS_DOMAIN/stands/" + prod.ID
	if rec := do(devReq("PUT", override, "core", map[string]any{"value": "example.com"})); rec.Code != http.StatusForbidden {
		t.Fatalf("member override: want 403, got %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(adminReq("PUT", "/api/v1/variables/OPS_DOMAIN/stands/no-such", map[string]any{"value": "x"})); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown stand: want 404, got %d %s", rec.Code, rec.Body.String())
	}
	rec = do(adminReq("PUT", override, map[string]any{"value": "example.com"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("override: %d %s", rec.Code, rec.Body.String())
	}
	var v models.Variable
	decode(t, rec, &v)
	if v.Value != "dev.example.com" || len(v.Overrides) != 1 || v.Overrides[0].StandID != prod.ID || v.Overrides[0].Value != "example.com" {
		t.Fatalf("variable after override: %+v", v)
	}

	rec = do(adminReq("PUT", override, map[string]any{"value": ""}))
	if rec.Code != http.StatusOK {
		t.Fatalf("clear: %d %s", rec.Code, rec.Body.String())
	}
	decode(t, rec, &v)
	if len(v.Overrides) != 0 {
		t.Fatalf("an empty value must clear the override: %+v", v)
	}

	if rec := do(adminReq("PUT", override, map[string]any{"value": "example.com"})); rec.Code != http.StatusOK {
		t.Fatalf("override again: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(devReq("DELETE", override, "core", nil)); rec.Code != http.StatusForbidden {
		t.Fatalf("member delete: want 403, got %d", rec.Code)
	}
	if rec := do(adminReq("DELETE", override, nil)); rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(adminReq("DELETE", override, nil)); rec.Code != http.StatusNotFound {
		t.Fatalf("delete again: want 404, got %d", rec.Code)
	}
}
