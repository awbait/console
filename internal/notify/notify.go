// Package notify writes the portal's notifications. It is the only place that
// does: every domain that has something to tell a person calls it, in the same
// transaction that records the event itself, so there is never a notification
// about something that did not happen - nor an event nobody heard about.
//
// What it does not do is decide the wording. A notification carries a kind and
// a payload; the sentence is composed in the interface, where the rest of the
// product's text lives. That keeps one voice in one place and lets a phrase be
// rewritten without touching what is already stored.
package notify

import (
	"context"
	"log/slog"

	"github.com/google/uuid"
	"console/internal/events"
	"console/internal/store"
	"console/pkg/models"
)

// Service records notifications and tells the connected browsers that something
// arrived. The signal carries no content: a client hears "there is news" and
// reads the feed, which is what lets the same signal cross between replicas
// without carrying anything private on the way (see internal/events).
type Service struct {
	store store.Store
	bus   events.Bus
	log   *slog.Logger
	// adminTeam is the group that owns what the platform team owns: the charts
	// nobody has adopted, and the services the platform runs itself. It is a
	// group, not a team - it grants the admin role and never appears in
	// anybody's team list (internal/auth/rbac.go) - so a notification addressed
	// to it as a team would reach nobody at all.
	adminTeam string
}

// New builds a notify service. The bus may be nil (tests, one-off tools): then
// nothing is signalled and clients find the notification when they next look.
func New(st store.Store, bus events.Bus, log *slog.Logger) *Service {
	return &Service{store: st, bus: bus, log: log}
}

// SetAdminTeam names the admin group (main wires it from the configuration), so
// what it owns is addressed to the admin role instead.
func (s *Service) SetAdminTeam(team string) { s.adminTeam = team }

func (s *Service) logger() *slog.Logger {
	if s.log != nil {
		return s.log
	}
	return slog.Default()
}

// Notification is what a caller describes: who it is for, what it is about, and
// what the interface needs to word it. Everything else - the id, the time - is
// the service's business.
type Notification struct {
	Kind        string
	SubjectType string
	SubjectID   string
	Audience    models.NotificationAudience
	AudienceKey string
	Actor       string
	ActorName   string
	Payload     map[string]any
	Level       models.NotificationLevel
	// DedupKey makes the call idempotent. Anything a background loop can reach
	// twice must set it, or one event becomes a notification every tick.
	DedupKey string
}

// Send records one notification. A repeat of a DedupKey already stored is not
// an error and not news: it is silently the same notification.
//
// It never fails the caller's own work: telling somebody about a merged change
// is worth less than the merge, so a failure here is logged and swallowed. The
// caller passes its own store when it is inside a transaction, so the
// notification commits or rolls back with the event it belongs to.
func (s *Service) Send(ctx context.Context, st store.Store, n Notification) {
	if st == nil {
		st = s.store
	}
	level := n.Level
	if level == "" {
		level = models.LevelInfo
	}
	row := &models.Notification{
		ID:          uuid.Must(uuid.NewV7()).String(),
		Kind:        n.Kind,
		SubjectType: n.SubjectType,
		SubjectID:   n.SubjectID,
		Audience:    n.Audience,
		AudienceKey: n.AudienceKey,
		Actor:       n.Actor,
		ActorName:   n.ActorName,
		Payload:     n.Payload,
		Level:       level,
		DedupKey:    n.DedupKey,
	}
	if err := st.AddNotification(ctx, row); err != nil {
		// Error, not Warn: the message is gone for good. Nothing retries it, and
		// the portal carries on looking like it told somebody.
		s.logger().Error("notification not stored", "kind", n.Kind, "err", err)
		return
	}
	s.signal()
}

// signal tells the connected clients to re-read their feed. One global topic:
// the payload says nothing, so there is nothing to leak to a browser whose
// person the notification is not for, and the feed itself is filtered by the
// reader's own audience.
func (s *Service) signal() {
	if s.bus == nil {
		return
	}
	s.bus.Publish(events.Event{Topic: TopicNotifications, Type: "notifications_changed"})
}

// TopicNotifications is the bus topic the SSE endpoint subscribes to.
const TopicNotifications = "notifications"
