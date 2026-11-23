package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"console/internal/provisioning"
	"console/pkg/models"
)

func TestHTTPValidateRequest(t *testing.T) {
	srv, _, prov := newServer(t)
	h := srv.Router()

	// Create an order; newServer runs GitLab in auto-merge mode, so Reconcile
	// advances the create MR straight to a live state.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, devReq("POST", "/api/v1/requests", "core", map[string]any{
		"chart": "platform/postgres", "version": "15.4.2", "team": "core",
		"service_name": "pg-val",
		"values":       map[string]any{"auth": map[string]any{"database": "app"}},
	}))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d body=%s", rec.Code, rec.Body.String())
	}
	var created models.Request
	_ = json.Unmarshal(rec.Body.Bytes(), &created)

	_ = prov.Reconcile(t.Context())

	// Valid change returns 200 with changed=true and does not open an MR.
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, devReq("POST", "/api/v1/requests/"+created.ID+"/validate", "core", map[string]any{
		"values": map[string]any{
			"auth":    map[string]any{"database": "app"},
			"primary": map[string]any{"replicas": 3},
		},
	}))
	if rec.Code != http.StatusOK {
		t.Fatalf("validate valid: %d body=%s", rec.Code, rec.Body.String())
	}
	var res provisioning.ValidateResult
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("decode validate result: %v", err)
	}
	if !res.Changed || !strings.Contains(res.ValuesYAML, "replicas: 3") {
		t.Fatalf("unexpected validate result: %+v", res)
	}
	mrsAfter, _ := srv.Prov.ListMRs(t.Context(), created.ID)
	if len(mrsAfter) != 1 {
		t.Fatalf("validate opened an MR: got %d MRs", len(mrsAfter))
	}

	// Unchanged values return 200 with changed=false.
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, devReq("POST", "/api/v1/requests/"+created.ID+"/validate", "core", map[string]any{
		"values": map[string]any{"auth": map[string]any{"database": "app"}},
	}))
	if rec.Code != http.StatusOK {
		t.Fatalf("validate same: %d body=%s", rec.Code, rec.Body.String())
	}
	res = provisioning.ValidateResult{}
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if res.Changed {
		t.Fatalf("want changed=false, got true")
	}

	// Schema violation returns 422 with per-field details.
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, devReq("POST", "/api/v1/requests/"+created.ID+"/validate", "core", map[string]any{
		"values": map[string]any{
			"auth":    map[string]any{"database": "app"},
			"primary": map[string]any{"replicas": "bad"},
		},
	}))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("validate invalid: want 422, got %d body=%s", rec.Code, rec.Body.String())
	}
	var errResp struct {
		Error   string                    `json:"error"`
		Details []provisioning.FieldError `json:"details"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &errResp)
	if errResp.Error != "validation_failed" || len(errResp.Details) == 0 || errResp.Details[0].Path != "/primary/replicas" {
		t.Fatalf("unexpected 422 payload: %+v", errResp)
	}

	// Unauthorized team gets 403.
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, devReq("POST", "/api/v1/requests/"+created.ID+"/validate", "other", map[string]any{
		"values": map[string]any{"auth": map[string]any{"database": "app"}},
	}))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("validate forbidden: want 403, got %d", rec.Code)
	}

	// Malformed JSON gets 400.
	badReq := httptest.NewRequest("POST", "/api/v1/requests/"+created.ID+"/validate", strings.NewReader("{"))
	badReq.Header.Set("X-Dev-Teams", "core")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, badReq)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("validate bad json: want 400, got %d", rec.Code)
	}
}
