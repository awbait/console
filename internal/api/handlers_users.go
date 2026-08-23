package api

import (
	"net/http"
	"strconv"
	"time"

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

// activityFeedLimit is how many events one page of the feed holds. A ribbon of
// what has been going on, not a journal: the full history of an order is on the
// order's own page, and the reader asks for more when they want more.
const activityFeedLimit = 30

// usersResponse is the whole page in one answer.
type usersResponse struct {
	Totals activity.Totals        `json:"totals"`
	Online []*models.PlatformUser `json:"online"`
	Users  []*models.PlatformUser `json:"users"`
	Teams  []*models.TeamActivity `json:"teams"`
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

// eventsResponse is one page of the feed, for everyone, a team or a person.
type eventsResponse struct {
	Events []*models.ActivityEvent `json:"events"`
	// HasMore says whether asking again past the last event returns anything,
	// so the page knows whether to offer "показать ещё" rather than finding out
	// by fetching nothing.
	HasMore bool `json:"has_more"`
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
	writeJSON(w, http.StatusOK, usersResponse{
		Totals: ov.Totals, Online: ov.Online, Users: ov.Users, Teams: ov.Teams,
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
	f := activityFilter(r, activityFeedLimit)
	// Ask for one more than the page holds: whether the extra row comes back is
	// the answer to "is there another page", and it costs nothing to look.
	want := f.Limit
	f.Limit = want + 1
	events, err := s.Store.ListActivity(r.Context(), f)
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	more := len(events) > want
	if more {
		events = events[:want]
	}
	writeJSON(w, http.StatusOK, eventsResponse{Events: nonNilEvents(events), HasMore: more})
}

// activityFilter reads the feed's query parameters. A limit that is missing or
// unreadable falls back to the caller's default, and the store clamps whatever
// gets through.
func activityFilter(r *http.Request, defaultLimit int) store.ActivityFilter {
	q := r.URL.Query()
	f := store.ActivityFilter{
		Actor:  q.Get("actor"),
		Team:   q.Get("team"),
		Limit:  defaultLimit,
		Oldest: q.Get("sort") == "oldest",
	}
	if n, err := strconv.Atoi(q.Get("limit")); err == nil && n > 0 {
		f.Limit = n
	}
	// An unreadable cursor is not an error worth a 400: it means the page asked
	// for "the next page after nothing", which is the first page.
	if t, err := time.Parse(time.RFC3339Nano, q.Get("cursor")); err == nil {
		f.Cursor = t
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
