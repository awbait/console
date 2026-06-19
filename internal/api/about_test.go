package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"console/internal/api"
)

func TestHTTPAbout(t *testing.T) {
	srv, _, _ := newServer(t)
	// Configure a couple of upstreams so links are surfaced; others stay empty.
	srv.System = api.SystemInfo{
		HarborURL:  "https://harbor.example",
		OIDCIssuer: "https://kc.example/realms/platform",
	}
	h := srv.Router()

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, devReq("GET", "/api/v1/info", "core", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("info: %d body=%s", rec.Code, rec.Body.String())
	}

	var got api.AboutInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Version == "" {
		t.Error("version must not be empty")
	}
	if got.GoVersion == "" {
		t.Error("go_version must not be empty")
	}
	// Only configured upstreams appear (Harbor + Keycloak); GitLab/ArgoCD are empty.
	labels := map[string]string{}
	for _, l := range got.Links {
		labels[l.Label] = l.URL
	}
	if labels["Harbor"] != "https://harbor.example" {
		t.Errorf("want Harbor link, got %+v", got.Links)
	}
	if _, ok := labels["Keycloak"]; !ok {
		t.Errorf("want Keycloak link, got %+v", got.Links)
	}
	if _, ok := labels["GitLab"]; ok {
		t.Errorf("GitLab should be absent when unconfigured, got %+v", got.Links)
	}
}
