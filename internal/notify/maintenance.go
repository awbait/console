package notify

import (
	"context"
	"time"

	"console/internal/store"
	"console/pkg/models"
)

// Planned maintenance. Everybody hears that a window is coming, that it was
// moved and that it is over; the admins also hear that one ran past its end,
// because they are the ones who end or extend it. Each message is about one
// window (SubjectID), and the dedup key names the window and, where a window
// can say the same thing twice, the times it says it about.

// MaintenanceAnnounced: a window was put on the calendar, or switched on at
// once (started). One message either way: "it starts at ten" and "it started"
// are the first news of the window, and a second one would repeat it.
func (s *Service) MaintenanceAnnounced(ctx context.Context, st store.Store, w *models.MaintenanceWindow, started bool, u *models.User) {
	kind := models.NotifyMaintenanceScheduled
	if started {
		kind = models.NotifyMaintenanceStarted
	}
	s.Send(ctx, st, Notification{
		Kind: kind, SubjectType: models.SubjectPlatform, SubjectID: w.ID,
		Audience: models.AudienceAll, Actor: actorSubject(u), ActorName: actorName(u),
		Payload: maintenancePayload(w), Level: models.LevelAttention,
		DedupKey: "maintenance:" + w.ID + ":announced",
	})
}

// MaintenanceSoon: the reminder shortly before a window starts. Once per
// window and start time: a window moved to later reminds again.
func (s *Service) MaintenanceSoon(ctx context.Context, st store.Store, w *models.MaintenanceWindow) {
	s.Send(ctx, st, Notification{
		Kind: models.NotifyMaintenanceSoon, SubjectType: models.SubjectPlatform, SubjectID: w.ID,
		Audience: models.AudienceAll, Payload: maintenancePayload(w), Level: models.LevelAttention,
		DedupKey: "maintenance:" + w.ID + ":soon:" + w.StartsAt.UTC().Format(time.RFC3339),
	})
}

// MaintenanceChanged: a window's start or planned end moved. The message alone
// changing is not news worth the bell: whoever is locked out reads it on the
// screen that locks them out.
func (s *Service) MaintenanceChanged(ctx context.Context, st store.Store, w *models.MaintenanceWindow, u *models.User) {
	s.Send(ctx, st, Notification{
		Kind: models.NotifyMaintenanceChanged, SubjectType: models.SubjectPlatform, SubjectID: w.ID,
		Audience: models.AudienceAll, Actor: actorSubject(u), ActorName: actorName(u),
		Payload: maintenancePayload(w), Level: models.LevelAttention,
		DedupKey: "maintenance:" + w.ID + ":changed:" + windowTimes(w),
	})
}

// MaintenanceEnded: the window is over, ended by an admin or by itself, or
// called off before it started (cancelled in the payload).
func (s *Service) MaintenanceEnded(ctx context.Context, st store.Store, w *models.MaintenanceWindow, cancelled bool, u *models.User) {
	p := maintenancePayload(w)
	p["cancelled"] = cancelled
	s.Send(ctx, st, Notification{
		Kind: models.NotifyMaintenanceEnded, SubjectType: models.SubjectPlatform, SubjectID: w.ID,
		Audience: models.AudienceAll, Actor: actorSubject(u), ActorName: actorName(u),
		Payload: p, Level: models.LevelInfo,
		DedupKey: "maintenance:" + w.ID + ":ended",
	})
}

// MaintenanceOverdue: an active window ran past its planned end and does not
// end by itself. To the admins, once per planned end: extending it and running
// past the new end is a second, separate piece of news.
func (s *Service) MaintenanceOverdue(ctx context.Context, st store.Store, w *models.MaintenanceWindow) {
	s.Send(ctx, st, Notification{
		Kind: models.NotifyMaintenanceOverdue, SubjectType: models.SubjectPlatform, SubjectID: w.ID,
		Audience: models.AudienceRole, AudienceKey: string(models.RoleAdmin),
		Payload: maintenancePayload(w), Level: models.LevelAttention,
		DedupKey: "maintenance:" + w.ID + ":overdue:" + windowTimes(w),
	})
}

func maintenancePayload(w *models.MaintenanceWindow) map[string]any {
	p := map[string]any{"starts_at": w.StartsAt.UTC().Format(time.RFC3339)}
	if w.EndsAt != nil {
		p["ends_at"] = w.EndsAt.UTC().Format(time.RFC3339)
	}
	return p
}

// windowTimes is the window's start and planned end as one key part.
func windowTimes(w *models.MaintenanceWindow) string {
	k := w.StartsAt.UTC().Format(time.RFC3339) + "/"
	if w.EndsAt != nil {
		k += w.EndsAt.UTC().Format(time.RFC3339)
	}
	return k
}
