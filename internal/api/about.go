package api

import (
	"net/http"

	"console/internal/buildinfo"
)

// AboutLink is one external UI link surfaced on the "About" page.
type AboutLink struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}

// AboutInfo is the payload for GET /api/v1/info: build metadata plus the
// configured external UI links. Available to any authenticated user (unlike the
// admin-only status page, this is purely informational).
type AboutInfo struct {
	Version   string      `json:"version"`
	Commit    string      `json:"commit,omitempty"`
	BuildDate string      `json:"build_date,omitempty"`
	GoVersion string      `json:"go_version"`
	Links     []AboutLink `json:"links"`
}

// handleAbout returns the portal version and useful links.
func (s *Server) handleAbout(w http.ResponseWriter, _ *http.Request) {
	bi := buildinfo.Get()
	writeJSON(w, http.StatusOK, AboutInfo{
		Version:   bi.Version,
		Commit:    bi.Commit,
		BuildDate: bi.BuildDate,
		GoVersion: bi.GoVersion,
		Links:     s.aboutLinks(),
	})
}

// aboutLinks builds the external UI link list from configured upstreams,
// skipping any that are not set (e.g. fake/dev mode).
func (s *Server) aboutLinks() []AboutLink {
	out := make([]AboutLink, 0, 4)
	add := func(label, url string) {
		if url != "" {
			out = append(out, AboutLink{Label: label, URL: url})
		}
	}
	add("Harbor", s.System.HarborURL)
	add("GitLab", s.System.GitLabURL)
	add("Argo CD", s.System.ArgoCDURL)
	add("Keycloak", issuerBase(s.System.OIDCIssuer))
	return out
}
