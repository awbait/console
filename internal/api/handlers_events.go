package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"console/internal/auth"
)

// handleAllRequestEvents streams status changes for ALL requests (a global
// topic) so list views can refresh live. The payload is only a "something
// changed" signal - the client re-fetches the team-scoped list on each event.
func (s *Server) handleAllRequestEvents(w http.ResponseWriter, r *http.Request) {
	s.stream(w, r, "requests")
}

func (s *Server) handleRequestEvents(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	id := chi.URLParam(r, "id")
	if _, err := s.Prov.Get(r.Context(), u, id); err != nil { // authz
		s.writeDomainErr(w, r, err)
		return
	}
	s.stream(w, r, "request:"+id)
}
