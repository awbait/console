package api

import (
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// spaHandler serves the embedded single-page frontend:
//   - an existing file is served as-is (hashed assets get a long immutable cache);
//   - the app shell (index.html) is served with no-cache so deploys take effect;
//   - an unknown path without a file extension is a client-side route and falls
//     back to the shell; a missing path WITH an extension (a stale asset) is 404.
//
// The FS is read-only and embedded in the binary, so there is no host filesystem
// and no path-traversal surface.
func spaHandler(dist fs.FS) (http.Handler, error) {
	index, err := fs.ReadFile(dist, "index.html")
	if err != nil {
		return nil, err
	}
	files := http.FileServer(http.FS(dist))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")

		serveShell := func() {
			w.Header().Set("Cache-Control", "no-cache")
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write(index)
		}

		upath := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if upath == "" || upath == "index.html" {
			serveShell()
			return
		}
		if f, ferr := dist.Open(upath); ferr == nil {
			info, _ := f.Stat()
			_ = f.Close()
			if info != nil && !info.IsDir() {
				if strings.HasPrefix(upath, "assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				files.ServeHTTP(w, r)
				return
			}
		}
		if path.Ext(upath) != "" {
			http.NotFound(w, r)
			return
		}
		serveShell()
	}), nil
}
