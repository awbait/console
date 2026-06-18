// Package spa embeds the built single-page frontend so the portal serves the UI
// itself, with no separate web server. The real assets are injected at image
// build time (the Dockerfile copies web/dist into ./dist before `go build`); a
// committed placeholder index.html keeps local builds compiling.
package spa

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var distFS embed.FS

// FS returns the SPA file tree rooted at the dist directory.
func FS() (fs.FS, error) {
	return fs.Sub(distFS, "dist")
}
