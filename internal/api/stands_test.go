package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"console/pkg/models"
)

// Stands over HTTP: anybody signed in reads them, admins write them, and an
// order placed with a stand carries the stand and a cluster: the one it named
// or the stand's default.
func TestHTTPStands(t *testing.T) {
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
	order := func(svc string, extra map[string]any) map[string]any {
		body := map[string]any{
			"chart": "platform/postgres", "version": "15.4.2", "team": "core",
			"service_name": svc, "draft": true,
			"values": map[string]any{"auth": map[string]any{"database": "app"}},
		}
		for k, v := range extra {
			body[k] = v
		}
		return body
	}

	// Empty, but a list: the selector iterates over it.
	rec := do(devReq("GET", "/api/v1/stands", "core", nil))
	if rec.Code != http.StatusOK || rec.Body.String() != "[]\n" {
		t.Fatalf("member list: %d %q", rec.Code, rec.Body.String())
	}
	if rec := do(devReq("POST", "/api/v1/stands", "core", map[string]any{"name": "dev", "default_cluster": "in-cluster", "git_path": "managed-services/dev"})); rec.Code != http.StatusForbidden {
		t.Fatalf("member create: want 403, got %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(adminReq("POST", "/api/v1/stands", map[string]any{"name": "dev", "default_cluster": "Bad Name", "git_path": "managed-services/dev"})); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("bad cluster: want 422, got %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(adminReq("POST", "/api/v1/stands", map[string]any{"name": "dev", "default_cluster": "in-cluster"})); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("no path: want 422, got %d %s", rec.Code, rec.Body.String())
	}

	rec = do(adminReq("POST", "/api/v1/stands", map[string]any{"name": "dev", "default_cluster": "in-cluster", "git_path": "managed-services/dev"}))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	var dev models.Stand
	decode(t, rec, &dev)
	if dev.ID == "" || !dev.Default || dev.DefaultCluster != "in-cluster" || dev.Layout != models.LayoutGroup || dev.GitPath != "managed-services/dev" {
		t.Fatalf("created stand: %+v", dev)
	}
	if rec := do(adminReq("POST", "/api/v1/stands", map[string]any{"name": "dev", "default_cluster": "other", "git_path": "managed-services/other"})); rec.Code != http.StatusConflict {
		t.Fatalf("duplicate name: want 409, got %d %s", rec.Code, rec.Body.String())
	}

	rec = do(adminReq("POST", "/api/v1/stands", map[string]any{"name": "edge", "default_cluster": "edge", "layout": "repository", "git_path": "managed-services/edge-gitops"}))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create edge: %d %s", rec.Code, rec.Body.String())
	}
	var edge models.Stand
	decode(t, rec, &edge)
	if edge.Default || edge.Layout != models.LayoutRepository {
		t.Fatalf("the second stand is not the default and keeps its layout: %+v", edge)
	}

	rec = do(adminReq("PATCH", "/api/v1/stands/"+edge.ID, map[string]any{"name": "edge-2", "default_cluster": "edge", "layout": "repository", "git_path": "managed-services/edge-gitops"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("rename: %d %s", rec.Code, rec.Body.String())
	}
	rec = do(adminReq("GET", "/api/v1/stands/"+edge.ID, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("get: %d %s", rec.Code, rec.Body.String())
	}
	decode(t, rec, &edge)
	if edge.Name != "edge-2" || edge.Locked {
		t.Fatalf("get after rename: %+v", edge)
	}
	// What ops applies to wire the stand, and the stand's own checks: without
	// upstreams here the checks say they could not look, and say so for each.
	rec = do(adminReq("GET", "/api/v1/stands/"+edge.ID+"/manifests", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "managed-services/edge-gitops") {
		t.Fatalf("manifests: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(devReq("GET", "/api/v1/stands/"+edge.ID+"/manifests", "core", nil)); rec.Code != http.StatusForbidden {
		t.Fatalf("member manifests: want 403, got %d", rec.Code)
	}
	rec = do(adminReq("GET", "/api/v1/stands/"+edge.ID+"/checks", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("checks: %d %s", rec.Code, rec.Body.String())
	}
	var checksBody struct {
		Results []struct {
			ID      string `json:"id"`
			Verdict string `json:"verdict"`
		} `json:"results"`
	}
	decode(t, rec, &checksBody)
	if len(checksBody.Results) != 3 || checksBody.Results[0].Verdict != "unknown" {
		t.Fatalf("stand checks: %+v", checksBody.Results)
	}
	if rec := do(adminReq("PATCH", "/api/v1/stands/missing", map[string]any{"name": "x", "default_cluster": "x", "git_path": "x"})); rec.Code != http.StatusNotFound {
		t.Fatalf("rename missing: want 404, got %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(adminReq("POST", "/api/v1/stands/"+edge.ID+"/default", nil)); rec.Code != http.StatusNoContent {
		t.Fatalf("set default: %d %s", rec.Code, rec.Body.String())
	}

	rec = do(devReq("GET", "/api/v1/stands", "core", nil))
	var list []models.Stand
	decode(t, rec, &list)
	if len(list) != 2 || !list[0].Default || list[0].Name != "edge-2" || list[1].Default {
		t.Fatalf("list after default moved: %+v", list)
	}

	// An order names its stand and starts from that stand's default cluster.
	rec = do(devReq("POST", "/api/v1/requests", "core", order("pg1", map[string]any{"stand_id": dev.ID})))
	if rec.Code != http.StatusCreated {
		t.Fatalf("order: %d %s", rec.Code, rec.Body.String())
	}
	var onDev models.Request
	decode(t, rec, &onDev)
	if onDev.StandID != dev.ID || onDev.Cluster != "in-cluster" {
		t.Fatalf("order stand=%q cluster=%q", onDev.StandID, onDev.Cluster)
	}
	// Without a stand it lands on the default; with a cluster of its own it
	// keeps that cluster.
	rec = do(devReq("POST", "/api/v1/requests", "core", order("pg2", map[string]any{"cluster": "edge-b"})))
	if rec.Code != http.StatusCreated {
		t.Fatalf("order on default: %d %s", rec.Code, rec.Body.String())
	}
	var onDefault models.Request
	decode(t, rec, &onDefault)
	if onDefault.StandID != edge.ID || onDefault.Cluster != "edge-b" {
		t.Fatalf("order without a stand: stand=%q cluster=%q", onDefault.StandID, onDefault.Cluster)
	}

	rec = do(devReq("GET", "/api/v1/requests?stand="+edge.ID, "core", nil))
	var filtered []models.Request
	decode(t, rec, &filtered)
	if len(filtered) != 1 || filtered[0].ID != onDefault.ID {
		t.Fatalf("filter by stand: %+v", filtered)
	}
	if rec := do(devReq("POST", "/api/v1/requests", "core", order("pg3", map[string]any{"stand_id": "gone"}))); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("unknown stand: want 422, got %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(devReq("POST", "/api/v1/requests", "core", order("pg4", map[string]any{"cluster": "Bad"}))); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("bad cluster: want 422, got %d %s", rec.Code, rec.Body.String())
	}
}
