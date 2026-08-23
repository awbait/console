package api

import (
	"net/http"
	"strconv"

	"console/internal/activity"
	"console/internal/auth"
	"console/pkg/models"
)

// Who uses the portal, for the platform admin. Two endpoints because they are
// read at two rhythms: "who is online" is small and refreshes on its own every
// few seconds, the rest is a page load.
//
// Names live here, behind a session, and not in the gauges: /metrics is served
// on its own port with no authentication (see cmd/portal), and a per-person
// series there would turn a scrape into the company's staff list - one that
// outlives the person, since a series stays in the time series database until
// retention takes it. The dashboard gets the numbers, this gets the names.

// activityFeedLimit is how many events the activity page shows. A ribbon of
// what has been going on, not a journal: the full history of an order is on the
// order's own page.
const activityFeedLimit = 60

// activityResponse is the whole page in one answer.
type activityResponse struct {
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

// adminActivity guards both endpoints and returns the recorder. Same gate as
// the rest of the admin area: this is a page about named people, and no other
// role has a reason to read it.
func (s *Server) adminActivity(w http.ResponseWriter, r *http.Request) (*activity.Recorder, bool) {
	if u := auth.UserFrom(r.Context()); u == nil || !u.IsAdmin() {
		writeErr(w, http.StatusForbidden, "forbidden", "platform activity is restricted to platform admins")
		return nil, false
	}
	if s.Activity == nil {
		writeErr(w, http.StatusServiceUnavailable, "internal", "activity is not available")
		return nil, false
	}
	return s.Activity, true
}

func (s *Server) handleActivity(w http.ResponseWriter, r *http.Request) {
	rec, ok := s.adminActivity(w, r)
	if !ok {
		return
	}
	ov, err := rec.Overview(r.Context())
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	limit := activityFeedLimit
	if n, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && n > 0 {
		limit = n
	}
	events, err := s.Store.ListActivity(r.Context(), limit)
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	if events == nil {
		events = []*models.ActivityEvent{}
	}
	writeJSON(w, http.StatusOK, activityResponse{
		Totals: ov.Totals, Online: ov.Online, Users: ov.Users, Teams: ov.Teams, Events: events,
		OnlineWindowSeconds: int(activity.OnlineWindow.Seconds()),
		GrafanaURL:          s.System.GrafanaURL,
	})
}

func (s *Server) handleOnline(w http.ResponseWriter, r *http.Request) {
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
