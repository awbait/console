package harbor

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"path"
	"strings"
	"testing"

	"console/pkg/models"
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
	// The client verifies the blob against this digest, so it must be the real
	// sha256 of the served tgz.
	sum := sha256.Sum256(tgz)
	layerDigest := "sha256:" + hex.EncodeToString(sum[:])
	mux := http.NewServeMux()

	mux.HandleFunc("/api/v2.0/health", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"status":"healthy"}`))
	})
	mux.HandleFunc("/api/v2.0/projects/platform/repositories", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`[{"name":"platform/ingress-gateway","description":"Edge gateway"}]`))
	})
	mux.HandleFunc("/api/v2.0/projects/platform/repositories/ingress-gateway/artifacts", func(w http.ResponseWriter, r *http.Request) {
		// The second artifact is what an earlier upload of the same version leaves
		// behind: same version in its metadata, tag long since moved away. The
		// catalog must show 3.1.0 once, as the tagged artifact.
		_, _ = w.Write([]byte(`[
			{"digest":"sha256:manifest1","push_time":"2026-05-20T00:00:00Z","tags":[{"name":"3.1.0"}],"extra_attrs":{"version":"3.1.0","appVersion":"3.1.0","description":"Edge gateway"}},
			{"digest":"sha256:leftover","push_time":"2026-05-19T00:00:00Z","tags":[],"extra_attrs":{"version":"3.1.0","appVersion":"3.1.0","description":"Edge gateway"}}
		]`))
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
	// One row per version, not one per upload: the stub also serves the untagged
	// artifact an earlier push of 3.1.0 left behind.
	if len(charts[0].Versions) != 1 || charts[0].Versions[0] != "3.1.0" {
		t.Fatalf("versions = %v, want [3.1.0]", charts[0].Versions)
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

func TestVerifyDigest(t *testing.T) {
	body := []byte("hello chart")
	sum := sha256.Sum256(body)
	good := "sha256:" + hex.EncodeToString(sum[:])

	if err := verifyDigest(good, body); err != nil {
		t.Fatalf("matching digest rejected: %v", err)
	}
	if err := verifyDigest("sha256:"+strings.Repeat("0", 64), body); err == nil {
		t.Fatal("mismatched digest accepted")
	}
	if err := verifyDigest("md5:abc", body); err == nil {
		t.Fatal("unsupported algorithm accepted")
	}
}

// TestPullFilesRejectsTraversal ensures a chart name that could escape the
// /v2/{project}/{name} path is refused before any registry call (M9).
func TestPullFilesRejectsTraversal(t *testing.T) {
	c := NewClient("https://harbor.invalid", "", "", []string{"platform"}, false, 0)
	for _, name := range []string{"../evil", "a/b", "name@host", "UPPER"} {
		if _, err := c.GetValues(context.Background(), "platform", name, "1.0.0"); err != models.ErrNotFound {
			t.Errorf("name %q: want ErrNotFound, got %v", name, err)
		}
	}
}

// TestLatestPerVersionCollapsesRepushes: a chart version re-uploaded three times
// is three artifacts in the repository, two of them untagged leftovers carrying
// the same version. The catalog must still see one 6.0.0, and it must be the
// artifact the tag points at (the one a pull resolves to).
func TestLatestPerVersionCollapsesRepushes(t *testing.T) {
	artifact := func(digest, push string, tags ...string) apiArtifact {
		a := apiArtifact{Digest: digest, PushTime: push}
		for _, tag := range tags {
			a.Tags = append(a.Tags, apiTag{Name: tag})
		}
		a.ExtraAttrs.Version = "6.0.0"
		return a
	}
	arts := []apiArtifact{
		artifact("sha256:first", "2026-09-01T10:00:00Z"),
		artifact("sha256:current", "2026-09-03T10:00:00Z", "6.0.0"),
		artifact("sha256:second", "2026-09-02T10:00:00Z"),
	}
	got := latestPerVersion(arts)
	if len(got) != 1 || got[0].Digest != "sha256:current" {
		t.Fatalf("latestPerVersion = %+v, want the tagged artifact only", got)
	}

	// No tag anywhere (the version was untagged in Harbor): the newest push wins,
	// so the version does not disappear from the catalog.
	untagged := []apiArtifact{
		artifact("sha256:old", "2026-09-01T10:00:00Z"),
		artifact("sha256:new", "2026-09-02T10:00:00Z"),
	}
	if got := latestPerVersion(untagged); len(got) != 1 || got[0].Digest != "sha256:new" {
		t.Fatalf("untagged: latestPerVersion = %+v, want the newest push", got)
	}

	// Different versions are all kept, and an artifact naming no version at all
	// (a leftover with neither metadata nor a tag) is not a catalog row.
	mixed := []apiArtifact{
		artifact("sha256:six", "2026-09-03T10:00:00Z", "6.0.0"),
		{Digest: "sha256:nameless", PushTime: "2026-09-04T10:00:00Z"},
	}
	mixed[1].ExtraAttrs.Version = ""
	five := artifact("sha256:five", "2026-08-01T10:00:00Z", "5.0.0")
	five.ExtraAttrs.Version = "5.0.0"
	mixed = append(mixed, five)
	got = latestPerVersion(mixed)
	if len(got) != 2 {
		t.Fatalf("mixed: latestPerVersion = %+v, want 6.0.0 and 5.0.0", got)
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
