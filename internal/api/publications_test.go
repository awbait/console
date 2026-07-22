package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"console/pkg/models"
)

// TestHTTPCheckChart: check a chart by path: fixture chart is complete,
// nonexistent gives ok=false, malformed path gives 422.
func TestHTTPCheckChart(t *testing.T) {
	srv, _, _ := newServer(t)
	h := srv.Router()

	do := func(body any) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, devReq("POST", "/api/v1/charts/check", "core", body))
		return rec
	}

	rec := do(map[string]any{"path": "platform/ingress-gateway"})
	if rec.Code != http.StatusOK {
		t.Fatalf("check: %d %s", rec.Code, rec.Body.String())
	}
	var res struct {
		OK    bool   `json:"ok"`
		Error string `json:"error"`
		Files []struct {
			Name     string `json:"name"`
			Required bool   `json:"required"`
			Found    bool   `json:"found"`
		} `json:"files"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if !res.OK || len(res.Files) != 4 {
		t.Fatalf("fixture chart must pass: %+v", res)
	}
	for _, f := range res.Files {
		if !f.Found {
			t.Fatalf("fixture file %s not found: %+v", f.Name, res)
		}
	}

	rec = do(map[string]any{"path": "platform/nope"})
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if rec.Code != http.StatusOK || res.OK || res.Error == "" {
		t.Fatalf("missing chart: %d %+v", rec.Code, res)
	}

	if rec := do(map[string]any{"path": "justname"}); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("bad path: %d", rec.Code)
	}
	if rec := do(map[string]any{"path": "a/b/c"}); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("nested path: %d", rec.Code)
	}
}

// TestHTTPCatalogIncludesOrphanPublication: a publication for a chart outside
// the Harbor listing is visible in the catalog with the missing flag.
func TestHTTPCatalogIncludesOrphanPublication(t *testing.T) {
	srv, _, _ := newServer(t)
	h := srv.Router()
	do := func(r *http.Request) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, r)
		return rec
	}

	if rec := do(adminReq("POST", "/api/v1/categories",
		map[string]any{"id": "network", "label": "Сеть"})); rec.Code != http.StatusCreated {
		t.Fatalf("category: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(devReq("POST", "/api/v1/publications", "core", map[string]any{
		"chart": "elsewhere/ghost", "category_id": "network", "owner_team": "core",
	})); rec.Code != http.StatusCreated {
		t.Fatalf("create publication: %d %s", rec.Code, rec.Body.String())
	}

	rec := do(devReq("GET", "/api/v1/catalog", "core", nil))
	var cat struct {
		Charts []struct {
			Project     string          `json:"project"`
			Name        string          `json:"name"`
			Missing     bool            `json:"missing"`
			Publication json.RawMessage `json:"publication"`
		} `json:"charts"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &cat)
	found := false
	for _, c := range cat.Charts {
		if c.Project == "elsewhere" && c.Name == "ghost" {
			found = true
			if !c.Missing || len(c.Publication) == 0 {
				t.Fatalf("orphan must be missing+with publication: %+v", c)
			}
		}
	}
	if !found {
		t.Fatalf("orphan publication not in catalog: %s", rec.Body.String())
	}
}

// adminReq builds a request authenticated as a dev admin.
func adminReq(method, path string, body any) *http.Request {
	r := devReq(method, path, "core", body)
	r.Header.Set("X-Dev-Role", string(models.RoleAdmin))
	return r
}

// TestHTTPPublicationsFlow runs the publication cycle over HTTP: category
// (admin) -> chart registration -> metadata change approval -> a published
// version -> default active view and overlay in /catalog.
func TestHTTPPublicationsFlow(t *testing.T) {
	srv, _, _ := newServer(t)
	h := srv.Router()

	do := func(r *http.Request) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, r)
		return rec
	}

	// categories: member cannot, admin can
	if rec := do(devReq("POST", "/api/v1/categories", "core",
		map[string]any{"id": "network", "label": "Сеть"})); rec.Code != http.StatusForbidden {
		t.Fatalf("member create category: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(adminReq("POST", "/api/v1/categories",
		map[string]any{"id": "network", "label": "Сеть", "sort": 20})); rec.Code != http.StatusCreated {
		t.Fatalf("admin create category: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(adminReq("POST", "/api/v1/categories",
		map[string]any{"id": "databases", "label": "Базы", "sort": 30})); rec.Code != http.StatusCreated {
		t.Fatalf("admin create category 2: %d %s", rec.Code, rec.Body.String())
	}

	// chart registration by the owner
	rec := do(devReq("POST", "/api/v1/publications", "core", map[string]any{
		"chart": "platform/ingress-gateway", "category_id": "network", "owner_team": "core",
	}))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create publication: %d %s", rec.Code, rec.Body.String())
	}
	var pub models.ChartPublication
	_ = json.Unmarshal(rec.Body.Bytes(), &pub)

	// no published version yet -> no view
	if rec := do(devReq("GET", "/api/v1/charts/platform/ingress-gateway/view", "core", nil)); rec.Code != http.StatusNotFound {
		t.Fatalf("view before publish: %d", rec.Code)
	}

	// metadata change: draft -> submit -> member approve 403 -> admin approve applies
	if rec := do(devReq("PATCH", "/api/v1/publications/"+pub.ID, "core",
		map[string]any{"category_id": "databases"})); rec.Code != http.StatusOK {
		t.Fatalf("patch category: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(devReq("POST", "/api/v1/publications/"+pub.ID+"/submit", "core", nil)); rec.Code != http.StatusOK {
		t.Fatalf("submit: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(devReq("POST", "/api/v1/publications/"+pub.ID+"/approve", "core", nil)); rec.Code != http.StatusForbidden {
		t.Fatalf("member approve: %d", rec.Code)
	}
	rec = do(adminReq("POST", "/api/v1/publications/"+pub.ID+"/approve", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("admin approve: %d %s", rec.Code, rec.Body.String())
	}
	var approved models.ChartPublication
	_ = json.Unmarshal(rec.Body.Bytes(), &approved)
	if approved.CategoryID != "databases" || approved.DraftCategoryID != "" {
		t.Fatalf("metadata approve must apply the draft: %+v", approved)
	}

	// publish version 1.0.0: draft -> submit -> approve -> orderable
	view := map[string]any{"views": map[string]any{"order": map[string]any{"identity": "/gateways/0/name", "include": []string{"gateways"}}}}
	base := "/api/v1/publications/" + pub.ID
	if rec := do(devReq("PUT", base+"/versions/1.0.0", "core", map[string]any{"view": view})); rec.Code != http.StatusOK {
		t.Fatalf("save version view: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(devReq("POST", base+"/versions/1.0.0/submit", "core", nil)); rec.Code != http.StatusOK {
		t.Fatalf("submit version: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(adminReq("POST", base+"/versions/1.0.0/approve", nil)); rec.Code != http.StatusOK {
		t.Fatalf("approve version: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(devReq("POST", base+"/versions/1.0.0/orderable", "core",
		map[string]any{"orderable": true})); rec.Code != http.StatusOK {
		t.Fatalf("orderable: %d %s", rec.Code, rec.Body.String())
	}

	// the default view (no ?version) resolves to the published version
	rec = do(devReq("GET", "/api/v1/charts/platform/ingress-gateway/view", "core", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("view after publish: %d %s", rec.Code, rec.Body.String())
	}
	var gotView struct {
		Views map[string]json.RawMessage `json:"views"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &gotView); err != nil || gotView.Views["order"] == nil {
		t.Fatalf("view body: %v %s", err, rec.Body.String())
	}

	// catalog: the chart carries the publication overlay
	rec = do(devReq("GET", "/api/v1/catalog", "core", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("catalog: %d %s", rec.Code, rec.Body.String())
	}
	var cat struct {
		Categories []models.Category `json:"categories"`
		Charts     []struct {
			models.Chart
			Publication *struct {
				CategoryID   string `json:"category_id"`
				OwnerTeam    string `json:"owner_team"`
				Published    bool   `json:"published"`
				HasOrderView bool   `json:"has_order_view"`
			} `json:"publication"`
		} `json:"charts"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &cat); err != nil {
		t.Fatalf("catalog body: %v", err)
	}
	if len(cat.Categories) != 2 {
		t.Fatalf("catalog categories: %+v", cat.Categories)
	}
	found := false
	for _, c := range cat.Charts {
		if c.Project == "platform" && c.Name == "ingress-gateway" {
			found = true
			if c.Publication == nil || !c.Publication.Published || !c.Publication.HasOrderView ||
				c.Publication.OwnerTeam != "core" || c.Publication.CategoryID != "databases" {
				t.Fatalf("publication overlay: %+v", c.Publication)
			}
		}
	}
	if !found {
		t.Fatalf("ingress-gateway not in catalog")
	}
}
