package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"console/pkg/models"
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

// The interface cannot name an owner it does not recognise as a group, so
// /auth/me carries which groups grant a role. Without the wiring the field is
// absent and every owner is printed as stored, which is what happens in tests
// and in dev mode.
func TestHTTPMeRoleGroups(t *testing.T) {
	srv, _, _ := newServer(t)

	var bare struct {
		Role       string            `json:"role"`
		RoleGroups map[string]string `json:"role_groups"`
	}
	rec := httptest.NewRecorder()
	srv.Router().ServeHTTP(rec, adminReq("GET", "/api/v1/auth/me", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("me: %d %s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &bare); err != nil {
		t.Fatal(err)
	}
	if bare.Role != "admin" {
		t.Fatalf("role = %q, want admin", bare.Role)
	}
	if len(bare.RoleGroups) != 0 {
		t.Fatalf("nothing wired, want no role_groups, got %v", bare.RoleGroups)
	}

	srv.RoleGroups = map[string]models.Role{
		"idp_ecpk_console/admin": models.RoleAdmin,
		"console/support":        models.RoleSupport,
	}
	var wired struct {
		RoleGroups map[string]string `json:"role_groups"`
	}
	rec = httptest.NewRecorder()
	srv.Router().ServeHTTP(rec, devReq("GET", "/api/v1/auth/me", "core", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("me: %d %s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &wired); err != nil {
		t.Fatal(err)
	}
	// Everybody gets the map: an owner has to be named the same way whoever is
	// looking at the catalog.
	if wired.RoleGroups["idp_ecpk_console/admin"] != "admin" ||
		wired.RoleGroups["console/support"] != "support" {
		t.Fatalf("role_groups = %v", wired.RoleGroups)
	}
}
