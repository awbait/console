package api

import (
	"encoding/json"
	"net/http"

	"console/internal/auth"
	"console/pkg/models"
	"github.com/go-chi/chi/v5"
)

// Stands: the places orders are placed on. Reading is open to anybody signed
// in (the order form offers them, the list filters by them), writing is the
// admin page.

type standBody struct {
	Name           string `json:"name"`
	DefaultCluster string `json:"default_cluster"`
}

func (s *Server) handleListStands(w http.ResponseWriter, r *http.Request) {
	list, err := s.Prov.ListStands(r.Context())
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleCreateStand(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	var body standBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", "invalid JSON")
		return
	}
	st := &models.Stand{Name: body.Name, DefaultCluster: body.DefaultCluster}
	if err := s.Prov.CreateStand(r.Context(), u, st); err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, st)
}

// handleUpdateStand replaces the name and the default cluster. The body
// carries both: the admin page edits them in place and sends the row as it
// stands.
func (s *Server) handleUpdateStand(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	var body standBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", "invalid JSON")
		return
	}
	st := &models.Stand{ID: chi.URLParam(r, "id"), Name: body.Name, DefaultCluster: body.DefaultCluster}
	if err := s.Prov.UpdateStand(r.Context(), u, st); err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) handleSetDefaultStand(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	if err := s.Prov.SetDefaultStand(r.Context(), u, chi.URLParam(r, "id")); err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusNoContent, nil)
}
