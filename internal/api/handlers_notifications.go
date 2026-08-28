package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"console/internal/auth"
	"console/internal/notify"
	"console/internal/store"
	"console/pkg/models"
)

// The reader's own feed. Who a notification is for is decided here, from the
// session: the subject, the teams and the role travel into the query as the
// audience predicate, so a person who leaves a team stops seeing its
// notifications without anything being rewritten.
//
// The auditor is read-only across the portal and is addressed by nothing, so
// their feed is empty by construction rather than by a special case here.

const notificationPageSize = 30

func notificationFilter(r *http.Request) store.NotificationFilter {
	u := auth.UserFrom(r.Context())
	f := store.NotificationFilter{Limit: notificationPageSize}
	if u == nil {
		return f
	}
	f.Subject, f.Teams, f.Role = u.Subject, u.Teams, string(u.Role)
	return f
}

// reader is who is asking, with the floor under their feed recorded first.
//
// Their appearance is recorded too, on every request, but on another goroutine -
// and the opening request of a session, the one whose answer fills the bell, can
// be served before that lands. So the read says it for itself; the write is a
// no-op once the floor is there.
//
// Failing to record it is logged rather than refused: the cost is a reader who
// sees more than they should, which is what the portal did before any of this.
func (s *Server) reader(r *http.Request) store.NotificationFilter {
	f := notificationFilter(r)
	if f.Subject == "" {
		return f
	}
	if err := s.Store.RecordAudiences(r.Context(), f.Subject, f.Teams, f.Role, time.Time{}); err != nil {
		s.logger().Warn("notification audiences not recorded", "actor", f.Subject, "err", err)
	}
	return f
}

func (s *Server) handleListNotifications(w http.ResponseWriter, r *http.Request) {
	f := s.reader(r)
	// `before` pages backwards through the feed: the created_at of the oldest
	// row already on screen. An unparsable value is no bound rather than an
	// error - the worst it does is show the newest page again.
	if v := r.URL.Query().Get("before"); v != "" {
		if t, err := time.Parse(time.RFC3339Nano, v); err == nil {
			f.Before = t
		}
	}
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 100 {
			f.Limit = n
		}
	}
	list, err := s.Store.ListNotifications(r.Context(), f)
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	if list == nil {
		list = []*models.Notification{}
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleUnreadNotifications(w http.ResponseWriter, r *http.Request) {
	count, err := s.Store.CountUnread(r.Context(), s.reader(r))
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"unread": count})
}

func (s *Server) handleReadNotification(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	if err := s.Store.MarkRead(r.Context(), chi.URLParam(r, "id"), u.Subject); err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusNoContent, nil)
}

func (s *Server) handleReadAllNotifications(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	if err := s.Store.MarkAllRead(r.Context(), u.Subject); err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusNoContent, nil)
}

// handleNotificationEvents streams a content-free "there is news" signal. The
// feed itself is fetched over the normal endpoint, filtered by who is asking,
// so a browser never receives a notification addressed to somebody else.
func (s *Server) handleNotificationEvents(w http.ResponseWriter, r *http.Request) {
	s.stream(w, r, notify.TopicNotifications)
}
