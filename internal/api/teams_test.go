package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// The owner selector asks for the teams the portal knows. Only an admin may
// read them, and a team is known once it owns a service or somebody from it has
// signed in.
func TestHTTPTeams(t *testing.T) {
	srv, _, _ := newServer(t)
	h := srv.Router()

	do := func(r *http.Request) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, r)
		return rec
	}

	if rec := do(devReq("GET", "/api/v1/teams", "core", nil)); rec.Code != http.StatusForbidden {
		t.Fatalf("member: want 403, got %d %s", rec.Code, rec.Body.String())
	}

	if rec := do(adminReq("POST", "/api/v1/categories",
		map[string]any{"id": "network", "label": "Сеть"})); rec.Code != http.StatusCreated {
		t.Fatalf("category: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(devReq("POST", "/api/v1/publications", "core", map[string]any{
		"chart": "library/nginx", "category_id": "network", "owner_team": "core",
	})); rec.Code != http.StatusCreated {
		t.Fatalf("publication: %d %s", rec.Code, rec.Body.String())
	}

	rec := do(adminReq("GET", "/api/v1/teams", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("admin: %d %s", rec.Code, rec.Body.String())
	}
	var got struct {
		Teams []string `json:"teams"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"core"} {
		found := false
		for _, tm := range got.Teams {
			if tm == want {
				found = true
			}
		}
		if !found {
			t.Fatalf("team %q missing from %v", want, got.Teams)
		}
	}
}
