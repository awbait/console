// Package buildinfo exposes the portal's version and build metadata. Version is
// injected at release time via ldflags; commit and date come for free from the
// Go toolchain's VCS stamping (debug.ReadBuildInfo) when building inside the
// repo.
package buildinfo

import (
	"runtime"
	"runtime/debug"
)

// Version is the release version, set at build time with
//
//	-ldflags "-X console/internal/buildinfo.Version=v1.2.3"
//
// It stays "dev" in unstamped (local) builds.
var Version = "dev"

// Info is the resolved build metadata returned to callers.
type Info struct {
	Version   string `json:"version"`
	Commit    string `json:"commit,omitempty"`
	BuildDate string `json:"build_date,omitempty"`
	GoVersion string `json:"go_version"`
}

// Get resolves the build metadata: Version from ldflags, commit/date from the
// toolchain's VCS stamping (present when built from a git work tree), Go version
// from the runtime.
func Get() Info {
	info := Info{Version: Version, GoVersion: runtime.Version()}
	bi, ok := debug.ReadBuildInfo()
	if !ok {
		return info
	}
	dirty := false
	for _, s := range bi.Settings {
		switch s.Key {
		case "vcs.revision":
			info.Commit = shortCommit(s.Value)
		case "vcs.time":
			info.BuildDate = s.Value
		case "vcs.modified":
			dirty = s.Value == "true"
		}
	}
	if dirty && info.Commit != "" {
		info.Commit += "-dirty"
	}
	return info
}

// shortCommit trims a full git SHA to the conventional 7-char prefix.
func shortCommit(sha string) string {
	if len(sha) > 7 {
		return sha[:7]
	}
	return sha
}
