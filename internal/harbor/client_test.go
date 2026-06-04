package harbor

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"path"
	"strings"
	"testing"
)

// buildChartTgz packs the vendored ingress-gateway chart into a Helm-style .tgz
// (entries rooted at "ingress-gateway/...") so the test can serve it as the OCI
// blob the real client extracts files from.
func buildChartTgz(t *testing.T) []byte {
	t.Helper()
	const root = "charts/platform/ingress-gateway"
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	err := fs.WalkDir(chartsFS, root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		b, err := fs.ReadFile(chartsFS, p)
		if err != nil {
			return err
		}
		name := "ingress-gateway/" + strings.TrimPrefix(p, root+"/")
		if err := tw.WriteHeader(&tar.Header{Name: name, Mode: 0o644, Size: int64(len(b)), Typeflag: tar.TypeReg}); err != nil {
			return err
		}
		_, err = tw.Write(b)
		return err
	})
	if err != nil {
		t.Fatalf("pack chart: %v", err)
	}
	if err := tw.Close(); err != nil {
		t.Fatalf("tar close: %v", err)
	}
	if err := gz.Close(); err != nil {
		t.Fatalf("gzip close: %v", err)
	}
	return buf.Bytes()
}

// harborStub emulates the slice of Harbor used by the client: the v2.0 catalog
// API plus the OCI distribution endpoints (with a bearer-token challenge).
func harborStub(t *testing.T, tgz []byte) *httptest.Server {
	t.Helper()
	const layerDigest = "sha256:layer1"
	mux := http.NewServeMux()

	mux.HandleFunc("/api/v2.0/health", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"status":"healthy"}`))
	})
	mux.HandleFunc("/api/v2.0/projects/platform/repositories", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`[{"name":"platform/ingress-gateway","description":"Edge gateway"}]`))
	})
	mux.HandleFunc("/api/v2.0/projects/platform/repositories/ingress-gateway/artifacts", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`[{"digest":"sha256:manifest1","push_time":"2026-05-20T00:00:00Z","tags":[{"name":"3.1.0"}],"extra_attrs":{"version":"3.1.0","appVersion":"3.1.0","description":"Edge gateway"}}]`))
	})

	// token realm
	mux.HandleFunc("/service/token", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"token":"testtoken"}`))
	})

	// OCI: require a bearer token; otherwise issue a challenge pointing at the realm.
	requireToken := func(w http.ResponseWriter, r *http.Request) bool {
		if r.Header.Get("Authorization") != "Bearer testtoken" {
			w.Header().Set("WWW-Authenticate",
				`Bearer realm="`+stubBase+`/service/token",service="harbor-registry",scope="repository:platform/ingress-gateway:pull"`)
			w.WriteHeader(http.StatusUnauthorized)
			return false
		}
		return true
	}
	mux.HandleFunc("/v2/platform/ingress-gateway/manifests/3.1.0", func(w http.ResponseWriter, r *http.Request) {
		if !requireToken(w, r) {
			return
		}
		w.Header().Set("Docker-Content-Digest", "sha256:manifest1")
		_, _ = w.Write([]byte(`{"schemaVersion":2,"layers":[{"mediaType":"` + helmChartLayerMediaType + `","digest":"` + layerDigest + `"}]}`))
	})
	mux.HandleFunc("/v2/platform/ingress-gateway/blobs/"+layerDigest, func(w http.ResponseWriter, r *http.Request) {
		if !requireToken(w, r) {
			return
		}
		_, _ = w.Write(tgz)
	})

	srv := httptest.NewServer(mux)
	stubBase = srv.URL // realm must point back at this server
	t.Cleanup(srv.Close)
	return srv
}

// stubBase is the running stub's base URL, needed inside the auth challenge.
var stubBase string

func TestClientCatalogAndChartFiles(t *testing.T) {
	ctx := context.Background()
	tgz := buildChartTgz(t)
	srv := harborStub(t, tgz)

	c := NewClient(srv.URL, "", "", []string{"platform"}, false, 0)

	// Healthz
	if err := c.Healthz(ctx); err != nil {
		t.Fatalf("Healthz: %v", err)
	}

	// ListCharts
	charts, err := c.ListCharts(ctx)
	if err != nil {
		t.Fatalf("ListCharts: %v", err)
	}
	if len(charts) != 1 || charts[0].Name != "ingress-gateway" || charts[0].Project != "platform" {
		t.Fatalf("ListCharts = %+v", charts)
	}
	if charts[0].LatestVersion != "3.1.0" {
		t.Fatalf("latest = %q, want 3.1.0", charts[0].LatestVersion)
	}
	if charts[0].Description != "Edge gateway" {
		t.Fatalf("description = %q", charts[0].Description)
	}

	// Versions
	vers, err := c.ListVersions(ctx, "platform", "ingress-gateway")
	if err != nil || len(vers) != 1 || vers[0].Version != "3.1.0" || vers[0].Digest != "sha256:manifest1" {
		t.Fatalf("ListVersions: err=%v vers=%+v", err, vers)
	}

	// Schema (extracted from the OCI .tgz via the bearer-token flow)
	schema, err := c.GetSchema(ctx, "platform", "ingress-gateway", "3.1.0")
	if err != nil {
		t.Fatalf("GetSchema: %v", err)
	}
	var doc map[string]any
	if err := json.Unmarshal(schema, &doc); err != nil {
		t.Fatalf("schema not JSON: %v", err)
	}
	props, _ := doc["properties"].(map[string]any)
	if _, ok := props["gateways"]; !ok {
		t.Fatalf("schema missing 'gateways'")
	}

	// Values + README + changelog
	if v, err := c.GetValues(ctx, "platform", "ingress-gateway", "3.1.0"); err != nil || len(v) == 0 {
		t.Fatalf("GetValues: err=%v len=%d", err, len(v))
	}
	if _, err := c.GetReadme(ctx, "platform", "ingress-gateway", "3.1.0"); err != nil {
		t.Fatalf("GetReadme: %v", err)
	}

	// the blob cache should now hold the extracted set keyed by manifest digest
	c.mu.Lock()
	_, cached := c.blobs["sha256:manifest1"]
	c.mu.Unlock()
	if !cached {
		t.Fatalf("expected extracted files cached by manifest digest")
	}
}

func TestExtractChartFilesIgnoresSubcharts(t *testing.T) {
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	write := func(name, body string) {
		_ = tw.WriteHeader(&tar.Header{Name: name, Mode: 0o644, Size: int64(len(body)), Typeflag: tar.TypeReg})
		_, _ = tw.Write([]byte(body))
	}
	write("mychart/values.yaml", "top: true\n")
	write("mychart/charts/sub/values.yaml", "sub: true\n") // must be ignored (too deep)
	_ = tw.Close()
	_ = gz.Close()

	files, err := extractChartFiles(buf.Bytes())
	if err != nil {
		t.Fatalf("extract: %v", err)
	}
	if got := string(files["values.yaml"]); got != "top: true\n" {
		t.Fatalf("top-level values.yaml = %q (subchart leaked?)", got)
	}
	if _, ok := files[path.Base("CHANGELOG.md")]; ok {
		t.Fatalf("unexpected changelog")
	}
}
