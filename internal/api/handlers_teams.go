package api

import (
	"net/http"
	"sort"

	"console/internal/auth"
	"console/internal/store"
)

// The teams the portal knows about, for the one control that has to name a team
// the reader does not belong to: the owner of a published service, which only a
// platform admin sets.
//
// There is no directory of teams to read. A team exists for the portal once it
// has appeared on somebody's sign-in or on a service somebody owns, so those two
// are what the list is built from. A team that has never done either cannot be
// offered here, and the admin section says where teams come from.

type teamsResponse struct {
	Teams []string `json:"teams"`
}

// handleListTeams answers with every team name the portal has seen, sorted.
// Admin only: it is the whole company's team list, and the owner selector is
// the only place that needs it. Everybody else may hand a service to their own
// teams, which the session already carries.
func (s *Server) handleListTeams(w http.ResponseWriter, r *http.Request) {
	if u := auth.UserFrom(r.Context()); u == nil || !u.IsAdmin() {
		writeErr(w, http.StatusForbidden, "forbidden", "the team list is restricted to platform admins")
		return
	}
	ctx := r.Context()
	seen := map[string]bool{}
	users, err := s.Store.ListUsers(ctx)
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	for _, u := range users {
		for _, t := range u.Teams {
			seen[t] = true
		}
	}
	// Whoever owns a service is offered even if nobody from that team has signed
	// in yet: the selector must be able to show the value it already holds.
	pubs, err := s.Pubs.List(ctx, store.PublicationFilter{})
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	for _, p := range pubs {
		if p.OwnerTeam != "" {
			seen[p.OwnerTeam] = true
		}
		if p.DraftOwnerTeam != "" {
			seen[p.DraftOwnerTeam] = true
		}
	}
	teams := make([]string, 0, len(seen))
	for t := range seen {
		teams = append(teams, t)
	}
	sort.Strings(teams)
	writeJSON(w, http.StatusOK, teamsResponse{Teams: teams})
}
