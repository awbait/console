package api

import (
	"encoding/json"
	"net/http"

	"console/internal/auth"
	"console/internal/checks"
	"console/internal/store"
	"console/pkg/models"
	"github.com/go-chi/chi/v5"
)

// Stands: the places orders are placed on. Reading is open to anybody signed
// in (the order form offers them, the list filters by them), writing is the
// admin page.

type standBody struct {
	Name           string `json:"name"`
	DefaultCluster string `json:"default_cluster"`
	Layout         string `json:"layout"`
	GitPath        string `json:"git_path"`
}

func (b standBody) stand(id string) *models.Stand {
	return &models.Stand{ID: id, Name: b.Name, DefaultCluster: b.DefaultCluster, Layout: b.Layout, GitPath: b.GitPath}
}

func (s *Server) handleListStands(w http.ResponseWriter, r *http.Request) {
	list, err := s.Prov.ListStands(r.Context())
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleGetStand(w http.ResponseWriter, r *http.Request) {
	st, err := s.Prov.GetStand(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) handleCreateStand(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	var body standBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", "invalid JSON")
		return
	}
	st := body.stand("")
	if err := s.Prov.CreateStand(r.Context(), u, st); err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, st)
}

// handleUpdateStand replaces the name, the default cluster, the layout and
// the path. The body carries all of them: the admin page edits them in place
// and sends the row as it stands.
func (s *Server) handleUpdateStand(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	var body standBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", "invalid JSON")
		return
	}
	st := body.stand(chi.URLParam(r, "id"))
	if err := s.Prov.UpdateStand(r.Context(), u, st); err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

// handleStandManifests answers with the Argo CD manifests that wire the
// stand: what ops applies, as YAML text. Admin only, as the stand page is.
func (s *Server) handleStandManifests(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	if !u.IsAdmin() {
		writeErr(w, http.StatusForbidden, "forbidden", "")
		return
	}
	st, err := s.Prov.GetStand(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	yaml, err := s.Prov.StandManifests(st)
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "application/yaml; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(yaml))
}

// handleStandChecks runs the stand's checks now and answers with them: they
// are read on the stand page, which is opened by the person about to wire
// the stand, so they are run on demand rather than in the background round.
func (s *Server) handleStandChecks(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	if !u.IsAdmin() {
		writeErr(w, http.StatusForbidden, "forbidden", "")
		return
	}
	st, err := s.Prov.GetStand(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	orders, err := s.Prov.List(r.Context(), u, store.RequestFilter{Stand: st.ID})
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"results": checks.Stand(r.Context(), s.StandGitLab, s.StandArgo, st, orders),
	})
}

func (s *Server) handleSetDefaultStand(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	if err := s.Prov.SetDefaultStand(r.Context(), u, chi.URLParam(r, "id")); err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusNoContent, nil)
}
