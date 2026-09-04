package api

import (
	"encoding/json"
	"net/http"

	"console/internal/auth"
	"console/internal/views"
	"console/pkg/models"
	"github.com/go-chi/chi/v5"
)

// Platform variables: the named values a version document references as
// "{{.Vars.OPS}}". Reading is open to anybody signed in (the constructor offers
// them while a document is written), writing is the admin page.

func (s *Server) handleListVariables(w http.ResponseWriter, r *http.Request) {
	list, err := s.Pubs.ListVariables(r.Context())
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	if list == nil {
		list = []*models.Variable{}
	}
	writeJSON(w, http.StatusOK, list)
}

// handleSetVariable creates a variable or replaces the one named in the path.
// One handler for both: the name is the key, so there is no difference between
// writing a variable that exists and one that does not.
func (s *Server) handleSetVariable(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	var v models.Variable
	if err := json.NewDecoder(r.Body).Decode(&v); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", "invalid JSON")
		return
	}
	if name := chi.URLParam(r, "name"); name != "" {
		v.Name = name
	}
	if err := s.Pubs.SetVariable(r.Context(), u, &v); err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

func (s *Server) handleDeleteVariable(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	if err := s.Pubs.DeleteVariable(r.Context(), u, chi.URLParam(r, "name")); err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusNoContent, nil)
}

// handleViewRefs answers with what a version document may reference in its
// "defaults" and "initial" blocks: the fixed catalogue plus the variables that
// exist right now. The constructor completes from it, so the list it offers is
// the same list the portal resolves against.
func (s *Server) handleViewRefs(w http.ResponseWriter, r *http.Request) {
	refs := views.TemplateRefs()
	vars, err := s.Pubs.ListVariables(r.Context())
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	for _, v := range vars {
		refs = append(refs, views.TemplateRef{
			Ref: ".Vars." + v.Name, Desc: v.Description, AtOrderForm: true,
		})
	}
	writeJSON(w, http.StatusOK, refs)
}

// handleVariableUsage answers where a variable is referenced, so the admin page
// can say what a deletion would break before it is attempted.
func (s *Server) handleVariableUsage(w http.ResponseWriter, r *http.Request) {
	used, err := s.Pubs.VariableUsage(r.Context(), chi.URLParam(r, "name"))
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	if used == nil {
		used = []string{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"used_by": used})
}
