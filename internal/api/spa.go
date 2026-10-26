package api

import (
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// spaHandler serves the embedded single-page frontend:
//   - an existing file is served as-is: hashed assets get a long immutable
//     cache, everything else (icons, docs, the Monaco bundle) an hour, because
//     the name stays the same across deploys. Without a header of our own there
//     would be none at all: the embedded FS has no modification time, so the
//     file server sends neither Last-Modified nor ETag and the browser refetches
//     the favicon on every page it opens;
//   - the app shell (index.html) is served with no-cache so deploys take effect;
//   - an unknown path is a client-side route and falls back to the shell, unless
//     it clearly asked for a static file: a missing name inside a directory the
//     build ships (assets/, docs-content/) or a missing root file with an
//     extension (favicon, robots.txt) is 404. The dot alone does not decide:
//     app routes carry chart versions like 12.0.0 in their last segment, and a
//     path.Ext check would turn a page reload there into a 404 (#504).
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
				} else {
					w.Header().Set("Cache-Control", "public, max-age=3600")
				}
				files.ServeHTTP(w, r)
				return
			}
		}
		if looksLikeStaticFile(dist, upath) {
			http.NotFound(w, r)
			return
		}
		serveShell()
	}), nil
}

// looksLikeStaticFile reports whether a path that is not in dist was a request
// for a file rather than a client-side route: it sits under a directory that
// exists in dist, or it is a single root-level name with an extension. Anything
// deeper and outside the shipped directories is the router's business, whatever
// characters its segments contain.
func looksLikeStaticFile(dist fs.FS, upath string) bool {
	dir, _, nested := strings.Cut(upath, "/")
	if !nested {
		return path.Ext(upath) != ""
	}
	info, err := fs.Stat(dist, dir)
	return err == nil && info.IsDir()
}
