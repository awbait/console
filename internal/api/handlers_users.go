package api

import (
	"net/http"
	"strconv"

	"console/internal/activity"
	"console/internal/auth"
	"console/internal/store"
	"console/pkg/models"
)

// Who uses the portal, for the platform admin. Three endpoints because they are
// read at three rhythms: the page loads once, "who is here now" refreshes on its
// own every few seconds, and the feed is re-asked whenever the reader narrows it
// to a team or a person.
//
// Names live here, behind a session, and not in the gauges: /metrics is served
// on its own port with no authentication (see cmd/portal), and a per-person
// series there would turn a scrape into the company's staff list - one that
// outlives the person, since a series stays in the time series database until
// retention takes it.

const (
	// activityFeedLimit is how many events the page shows at once. A ribbon of
	// what has been going on, not a journal: the full history of an order is on
	// the order's own page.
	activityFeedLimit = 60
	// personFeedLimit is the shorter list shown for one person.
	personFeedLimit = 30
)

// usersResponse is the whole page in one answer.
type usersResponse struct {
	Totals activity.Totals         `json:"totals"`
	Online []*models.PlatformUser  `json:"online"`
	Users  []*models.PlatformUser  `json:"users"`
	Teams  []*models.TeamActivity  `json:"teams"`
	Events []*models.ActivityEvent `json:"events"`
	// OnlineWindowSeconds is what "online" means here, so the page can say it
	// instead of hard-coding the same number a second time.
	OnlineWindowSeconds int `json:"online_window_seconds"`
	// GrafanaURL is where the trends are. Empty when GRAFANA_URL is not set,
	// and then the page simply does not offer the link.
	GrafanaURL string `json:"grafana_url,omitempty"`
}

// onlineResponse is the small, frequently-polled half.
type onlineResponse struct {
	Online              []*models.PlatformUser `json:"online"`
	OnlineWindowSeconds int                    `json:"online_window_seconds"`
}

// eventsResponse is the feed on its own, for a team or a person.
type eventsResponse struct {
	Events []*models.ActivityEvent `json:"events"`
}

// adminActivity guards every endpoint here and returns the recorder. Same gate
// as the rest of the admin area: these are pages about named people, and no
// other role has a reason to read them.
func (s *Server) adminActivity(w http.ResponseWriter, r *http.Request) (*activity.Recorder, bool) {
	if u := auth.UserFrom(r.Context()); u == nil || !u.IsAdmin() {
		writeErr(w, http.StatusForbidden, "forbidden", "the user directory is restricted to platform admins")
		return nil, false
	}
	if s.Activity == nil {
		writeErr(w, http.StatusServiceUnavailable, "internal", "the user directory is not available")
		return nil, false
	}
	return s.Activity, true
}

func (s *Server) handleUsers(w http.ResponseWriter, r *http.Request) {
	rec, ok := s.adminActivity(w, r)
	if !ok {
		return
	}
	ov, err := rec.Overview(r.Context())
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	events, err := s.Store.ListActivity(r.Context(), activityFilter(r, activityFeedLimit))
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, usersResponse{
		Totals: ov.Totals, Online: ov.Online, Users: ov.Users, Teams: ov.Teams,
		Events:              nonNilEvents(events),
		OnlineWindowSeconds: int(activity.OnlineWindow.Seconds()),
		GrafanaURL:          s.System.GrafanaURL,
	})
}

func (s *Server) handleUsersOnline(w http.ResponseWriter, r *http.Request) {
	rec, ok := s.adminActivity(w, r)
	if !ok {
		return
	}
	ov, err := rec.Overview(r.Context())
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, onlineResponse{
		Online: ov.Online, OnlineWindowSeconds: int(activity.OnlineWindow.Seconds()),
	})
}

// handleUserEvents answers the feed on its own: everything, one team's, or one
// person's. It is its own endpoint rather than a parameter of the page because
// narrowing the feed must not re-read the whole directory and presence with it.
func (s *Server) handleUserEvents(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminActivity(w, r); !ok {
		return
	}
	events, err := s.Store.ListActivity(r.Context(), activityFilter(r, personFeedLimit))
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, eventsResponse{Events: nonNilEvents(events)})
}

// activityFilter reads the feed's query parameters. A limit that is missing or
// unreadable falls back to the caller's default, and the store clamps whatever
// gets through.
func activityFilter(r *http.Request, defaultLimit int) store.ActivityFilter {
	f := store.ActivityFilter{
		Actor: r.URL.Query().Get("actor"),
		Team:  r.URL.Query().Get("team"),
		Limit: defaultLimit,
	}
	if n, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && n > 0 {
		f.Limit = n
	}
	return f
}

// nonNilEvents keeps an empty feed an empty array rather than null: the page
// maps over it.
func nonNilEvents(events []*models.ActivityEvent) []*models.ActivityEvent {
	if events == nil {
		return []*models.ActivityEvent{}
	}
	return events
}
