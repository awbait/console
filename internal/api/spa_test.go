package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestSPAHandler(t *testing.T) {
	fsys := fstest.MapFS{
		"index.html":            {Data: []byte("<html>shell</html>")},
		"assets/app.js":         {Data: []byte("console.log(1)")},
		"favicon.ico":           {Data: []byte("\x00\x00\x01\x00")},
		"docs-content/intro.md": {Data: []byte("# intro")},
	}
	h, err := spaHandler(fsys)
	if err != nil {
		t.Fatalf("spaHandler: %v", err)
	}

	cases := []struct {
		name, path   string
		wantCode     int
		wantBody     string
		wantCacheHas string
		wantTypeHas  string
	}{
		{"root serves shell", "/", 200, "shell", "no-cache", "text/html"},
		{"client route serves shell", "/requests/123", 200, "shell", "no-cache", "text/html"},
		{"asset served with immutable cache", "/assets/app.js", 200, "console.log", "immutable", ""},
		{"missing asset is 404", "/assets/missing.js", 404, "", "", ""},
		{"missing doc under a shipped directory is 404", "/docs-content/missing.md", 404, "", "", ""},
		{"missing root file with extension is 404", "/robots.txt", 404, "", "", ""},
		// A chart version in the last segment looks like a file extension to
		// path.Ext; the route must still get the shell on reload (#504).
		{"route with dotted version serves shell", "/catalog/managed-services/ingress-gateway/manage/12.0.0", 200, "shell", "no-cache", "text/html"},
		{"approval route with dotted version serves shell", "/approvals/managed-services/ingress-gateway/1.2.3", 200, "shell", "no-cache", "text/html"},
		// The icon is a real file, not the shell: an image content type (sniffed,
		// since .ico is missing from Go's table and from a scratch image's
		// /etc/mime.types) and a cache header of its own, because the embedded FS
		// gives the file server no modification time to revalidate against.
		{"favicon served as an image", "/favicon.ico", 200, "", "max-age=3600", "image/"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, c.path, nil))
			if rec.Code != c.wantCode {
				t.Fatalf("code = %d, want %d", rec.Code, c.wantCode)
			}
			if c.wantBody != "" && !strings.Contains(rec.Body.String(), c.wantBody) {
				t.Fatalf("body %q does not contain %q", rec.Body.String(), c.wantBody)
			}
			if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
				t.Fatalf("missing nosniff header")
			}
			if c.wantCacheHas != "" && !strings.Contains(rec.Header().Get("Cache-Control"), c.wantCacheHas) {
				t.Fatalf("Cache-Control %q does not contain %q", rec.Header().Get("Cache-Control"), c.wantCacheHas)
			}
			if c.wantTypeHas != "" && !strings.Contains(rec.Header().Get("Content-Type"), c.wantTypeHas) {
				t.Fatalf("Content-Type %q does not contain %q", rec.Header().Get("Content-Type"), c.wantTypeHas)
			}
		})
	}
}
