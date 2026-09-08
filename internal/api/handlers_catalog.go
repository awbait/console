package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"console/internal/auth"
	"console/pkg/models"
	"github.com/go-chi/chi/v5"
)

// authorizeChart enforces the chart visibility allowlist for the request user
// before any per-chart read. It writes a 404 and returns false when the chart is
// hidden or missing, so callers can `if !s.authorizeChart(...) { return }`.
// Without this gate a user could read a chart hidden from the listing by its URL.
func (s *Server) authorizeChart(w http.ResponseWriter, r *http.Request) bool {
	u := auth.UserFrom(r.Context())
	if _, err := s.Catalog.Authorize(r.Context(), u, chi.URLParam(r, "project"), chi.URLParam(r, "name")); err != nil {
		s.writeDomainErr(w, r, err)
		return false
	}
	return true
}

func (s *Server) handleListCharts(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	charts, err := s.Catalog.ListCharts(r.Context(), u)
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, charts)
}

func (s *Server) handleGetChart(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	chart, err := s.Catalog.Authorize(r.Context(), u, chi.URLParam(r, "project"), chi.URLParam(r, "name"))
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, chart)
}

func (s *Server) handleGetVersion(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeChart(w, r) {
		return
	}
	v, err := s.Catalog.GetVersion(r.Context(), chi.URLParam(r, "project"), chi.URLParam(r, "name"), chi.URLParam(r, "version"))
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

func (s *Server) handleGetValues(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeChart(w, r) {
		return
	}
	b, err := s.Catalog.GetValues(r.Context(), chi.URLParam(r, "project"), chi.URLParam(r, "name"), chi.URLParam(r, "version"))
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "text/yaml; charset=utf-8")
	_, _ = w.Write(b)
}

func (s *Server) handleGetReadme(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeChart(w, r) {
		return
	}
	b, err := s.Catalog.GetReadme(r.Context(), chi.URLParam(r, "project"), chi.URLParam(r, "name"), chi.URLParam(r, "version"))
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	_, _ = w.Write(b)
}

func (s *Server) handleGetSchema(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeChart(w, r) {
		return
	}
	b, err := s.Catalog.GetSchema(r.Context(), chi.URLParam(r, "project"), chi.URLParam(r, "name"), chi.URLParam(r, "version"))
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, _ = w.Write(b)
}

// chartDependencies is what the version constructor and the order form are
// given: the chart's dependencies, each with its own values.schema.json, and the
// one schema built out of them. "schema" (the endpoint above) stays the chart's
// file byte for byte; this is the file plus every dependency mounted under the
// key its values sit at, which is what an order is actually drawn from.
//
// The effective schema is absent when the chart describes nothing at all: no
// values.schema.json of its own and no dependency carrying one. That is not an
// error, it is a chart ordered as raw YAML.
type chartDependencies struct {
	Dependencies    []models.ChartDependency `json:"dependencies"`
	EffectiveSchema json.RawMessage          `json:"effective_schema,omitempty"`
}

func (s *Server) handleGetDependencies(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeChart(w, r) {
		return
	}
	project, name, version := chi.URLParam(r, "project"), chi.URLParam(r, "name"), chi.URLParam(r, "version")
	// Asked first, because below a "not found" has to mean "this chart describes
	// nothing", which is a normal answer. Without this a mistyped version would
	// come back as an empty schema and the order form would quietly offer raw
	// YAML for a version that is not in the registry at all.
	if _, err := s.Catalog.GetVersion(r.Context(), project, name, version); err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	schema, deps, err := s.Catalog.FormSchema(r.Context(), project, name, version)
	if err != nil && !errors.Is(err, models.ErrNotFound) {
		s.writeDomainErr(w, r, err)
		return
	}
	if deps == nil {
		deps = []models.ChartDependency{}
	}
	writeJSON(w, http.StatusOK, chartDependencies{Dependencies: deps, EffectiveSchema: schema})
}

func (s *Server) handleGetChangelog(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeChart(w, r) {
		return
	}
	e, err := s.Catalog.GetChangelog(r.Context(), chi.URLParam(r, "project"), chi.URLParam(r, "name"), chi.URLParam(r, "version"))
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, e)
}

func (s *Server) handleAggregatedChangelog(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeChart(w, r) {
		return
	}
	limit := 20
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	entries, err := s.Catalog.GetAggregatedChangelog(r.Context(), chi.URLParam(r, "project"), chi.URLParam(r, "name"), limit)
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, entries)
}
