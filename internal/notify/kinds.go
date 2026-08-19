package notify

import (
	"context"
	"time"

	"console/internal/store"
	"console/pkg/models"
)

// The notifications the portal sends, one function per kind. They live here
// rather than at the call sites so that the audience, the deduplication key and
// the payload of a kind are decided once: those three are what makes a
// notification right or wrong, and they are easy to get subtly different when
// spelled out at each caller.
//
// The payload carries what the sentence needs and nothing else. The interface
// must be able to word the notification without fetching the order it is about:
// a feed that has to resolve twenty ids to render is a feed that loads slowly
// and breaks when one of them is gone.

// OrderHealthy: the service the person ordered is running. Addressed to whoever
// filed the order - the team sees the state on the page, and a message to
// everyone is what teaches people to ignore the bell.
func (s *Service) OrderHealthy(ctx context.Context, st store.Store, r *models.Request, from string) {
	payload := orderPayload(r)
	// Coming up for the first time and coming back after a failure are different
	// news, and the interface says them differently.
	payload["recovered"] = from == string(models.StatusDegraded) || from == string(models.StatusArgoMissing)
	s.Send(ctx, st, Notification{
		Kind:        models.NotifyOrderHealthy,
		SubjectType: models.SubjectOrder,
		SubjectID:   r.ID,
		Audience:    models.AudienceUser,
		AudienceKey: r.CreatedBy,
		Payload:     payload,
		Level:       models.LevelInfo,
		// Per order, version and where it came from: a service that fell ill and
		// recovered is news again, the same healthy state every tick is not.
		DedupKey: "order:" + r.ID + ":healthy:" + r.ChartVersion + ":" + from,
	})
}

// OrderDegraded: the service stopped working, or the cluster no longer has it.
func (s *Service) OrderDegraded(ctx context.Context, st store.Store, r *models.Request, detail string) {
	payload := orderPayload(r)
	if detail != "" {
		payload["detail"] = detail
	}
	s.Send(ctx, st, Notification{
		Kind:        models.NotifyOrderDegraded,
		SubjectType: models.SubjectOrder,
		SubjectID:   r.ID,
		Audience:    models.AudienceUser,
		AudienceKey: r.CreatedBy,
		Payload:     payload,
		Level:       models.LevelAttention,
		DedupKey:    "order:" + r.ID + ":degraded:" + string(r.Status) + ":" + r.ChartVersion,
	})
}

// OrderChangeBlocked: a change to the service could not be applied on its own
// and is waiting for the person who made it. Reason is the portal's own word
// for why (conflict, need_rebase), not the upstream's message.
func (s *Service) OrderChangeBlocked(ctx context.Context, st store.Store, r *models.Request, reason string) {
	payload := orderPayload(r)
	if reason != "" {
		payload["reason"] = reason
	}
	s.Send(ctx, st, Notification{
		Kind:        models.NotifyOrderChangeBlocked,
		SubjectType: models.SubjectOrder,
		SubjectID:   r.ID,
		Audience:    models.AudienceUser,
		AudienceKey: r.CreatedBy,
		Payload:     payload,
		Level:       models.LevelAttention,
		DedupKey:    "order:" + r.ID + ":blocked:" + reason,
	})
}

// VersionApproved / VersionRejected: what became of a version its owner sent
// for approval. Addressed to the owning team rather than to the person who
// submitted it: publishing a service is the team's job, and the person who
// submitted may not be the one who fixes what the reviewer asked for.
func (s *Service) VersionApproved(ctx context.Context, st store.Store, p *models.ChartPublication, version string, u *models.User) {
	audience, key := s.owners(p)
	s.Send(ctx, st, Notification{
		Kind:        models.NotifyVersionApproved,
		SubjectType: models.SubjectVersion,
		SubjectID:   p.ID + "/" + version,
		Audience:    audience,
		AudienceKey: key,
		Actor:       actorSubject(u),
		ActorName:   actorName(u),
		Payload:     versionPayload(p, version, ""),
		Level:       models.LevelInfo,
	})
}

func (s *Service) VersionRejected(ctx context.Context, st store.Store, p *models.ChartPublication, version, comment string, u *models.User) {
	audience, key := s.owners(p)
	s.Send(ctx, st, Notification{
		Kind:        models.NotifyVersionRejected,
		SubjectType: models.SubjectVersion,
		SubjectID:   p.ID + "/" + version,
		Audience:    audience,
		AudienceKey: key,
		Actor:       actorSubject(u),
		ActorName:   actorName(u),
		Payload:     versionPayload(p, version, comment),
		Level:       models.LevelAttention,
	})
}

// ChartVersionAvailable: the registry has a newer version of a service than
// anything its owners have published. Until they write its document and have it
// approved, the catalog and every order of that service stay where they are -
// which is why this goes to the team rather than sitting on a page they would
// have to think to open.
func (s *Service) ChartVersionAvailable(ctx context.Context, st store.Store, p *models.ChartPublication, version string) {
	audience, key := s.owners(p)
	s.Send(ctx, st, Notification{
		Kind:        models.NotifyChartVersionAvailable,
		SubjectType: models.SubjectVersion,
		SubjectID:   p.ID + "/" + version,
		Audience:    audience,
		AudienceKey: key,
		Payload:     versionPayload(p, version, ""),
		Level:       models.LevelInfo,
		// The registry is read every tick; one release is one piece of news.
		DedupKey: "chart:" + p.ChartProject + "/" + p.ChartName + ":new_version:" + version,
	})
}

// VersionSubmitted: a service owner sent a version for approval, and somebody
// on the platform team has to decide. Addressed to the admin role rather than
// to a person: whoever opens the queue first takes it, and the queue is the
// role's job rather than anyone's in particular.
func (s *Service) VersionSubmitted(ctx context.Context, st store.Store, p *models.ChartPublication, version string, u *models.User) {
	s.Send(ctx, st, Notification{
		Kind:        models.NotifyVersionSubmitted,
		SubjectType: models.SubjectVersion,
		SubjectID:   p.ID + "/" + version,
		Audience:    models.AudienceRole,
		AudienceKey: string(models.RoleAdmin),
		Actor:       actorSubject(u),
		ActorName:   actorName(u),
		Payload:     versionPayload(p, version, ""),
		Level:       models.LevelAttention,
		// A version withdrawn and sent again is a new decision to make, so the
		// key carries the moment rather than only the version.
		DedupKey: "",
	})
}

// ChartDiscovered: the portal found a chart in the registry and registered a
// draft nobody owns yet. Until an admin gives it a category and an owner it is
// invisible in the catalog, so the find is only useful if somebody hears of it.
func (s *Service) ChartDiscovered(ctx context.Context, st store.Store, p *models.ChartPublication) {
	s.Send(ctx, st, Notification{
		Kind:        models.NotifyChartDiscovered,
		SubjectType: models.SubjectPublication,
		SubjectID:   p.ID,
		Audience:    models.AudienceRole,
		AudienceKey: string(models.RoleAdmin),
		Payload: map[string]any{
			"chart_project": p.ChartProject,
			"chart_name":    p.ChartName,
		},
		Level: models.LevelInfo,
		// One chart, one find: the registry is swept every tick, and a chart
		// that stays unadopted must not be announced on each of them.
		DedupKey: "chart:" + p.ChartProject + "/" + p.ChartName + ":discovered",
	})
}

// ChartVersionMissing: a published version is gone from the registry. Nothing
// can be ordered from it any more, and in the catalog the service falls in with
// the ones nobody ever published - so it goes to the team that owns it and to
// the admins, who are the ones who can put the chart back or publish another
// version.
//
// The ordinary user is not told: they cannot act on it, and the service is not
// offered to them anyway.
func (s *Service) ChartVersionMissing(ctx context.Context, st store.Store, p *models.ChartPublication, version string) {
	key := "chart:" + p.ChartProject + "/" + p.ChartName + ":missing:" + version
	audience, audienceKey := s.owners(p)
	s.Send(ctx, st, Notification{
		Kind:        models.NotifyChartVersionMissing,
		SubjectType: models.SubjectVersion,
		SubjectID:   p.ID + "/" + version,
		Audience:    audience,
		AudienceKey: audienceKey,
		Payload:     versionPayload(p, version, ""),
		Level:       models.LevelAttention,
		// The sweep notices it on every tick; one loss is one piece of news.
		DedupKey: key,
	})
	// The owning team hears it as the owner, the admins as the platform. When
	// the admin group owns the service those are the same audience, and the
	// deduplication key would drop the second one anyway - but saying it once is
	// clearer than relying on that.
	if audience == models.AudienceTeam {
		s.Send(ctx, st, Notification{
			Kind:        models.NotifyChartVersionMissing,
			SubjectType: models.SubjectVersion,
			SubjectID:   p.ID + "/" + version,
			Audience:    models.AudienceRole,
			AudienceKey: string(models.RoleAdmin),
			Payload:     versionPayload(p, version, ""),
			Level:       models.LevelAttention,
			DedupKey:    key + ":admin",
		})
	}
}

// PortalUpdated: the portal itself is a new version. Everyone sees it, and the
// deduplication key is the version, so a restart is not news and a deployment
// is - including a portal running in several copies, where whichever starts
// first writes it.
func (s *Service) PortalUpdated(ctx context.Context, version string) {
	if version == "" || version == "dev" {
		return // an unstamped build is not a release anybody was given
	}
	s.Send(ctx, nil, Notification{
		Kind:        models.NotifyPortalUpdated,
		SubjectType: models.SubjectPlatform,
		Audience:    models.AudienceAll,
		Payload:     map[string]any{"version": version},
		Level:       models.LevelInfo,
		DedupKey:    "portal:version:" + version,
	})
}

// SweepRead drops notifications that have been read and are older than the
// retention window. An unread one stays however old it is: nobody has seen it,
// so deleting it would be losing the message rather than tidying up.
func (s *Service) SweepRead(ctx context.Context, olderThan time.Duration) error {
	gone, err := s.store.DeleteReadNotificationsBefore(ctx, time.Now().Add(-olderThan))
	if err != nil {
		return err
	}
	if gone > 0 {
		s.logger().Debug("notifications swept", "count", gone)
	}
	return nil
}

// owners is who to address about a service: its owning team, or the admin role
// when the platform team owns it.
//
// A chart nobody has adopted belongs to the admin group, and so do the services
// the platform runs itself. That group is not a team: it grants the admin role
// and never lands in anybody's team list, so addressing it as a team reaches
// nobody - which is exactly what happened to every notification about such a
// service.
func (s *Service) owners(p *models.ChartPublication) (models.NotificationAudience, string) {
	if p.OwnerTeam == "" || (s.adminTeam != "" && p.OwnerTeam == s.adminTeam) {
		return models.AudienceRole, string(models.RoleAdmin)
	}
	return models.AudienceTeam, p.OwnerTeam
}

// orderPayload is what every order notification says about its service: enough
// to word the sentence without reading the order back.
func orderPayload(r *models.Request) map[string]any {
	name := r.DisplayName
	if name == "" {
		name = r.ServiceName
	}
	return map[string]any{
		"service_name": name,
		"chart_name":   r.ChartName,
		"team":         r.Team,
	}
}

func versionPayload(p *models.ChartPublication, version, comment string) map[string]any {
	out := map[string]any{
		"chart_name":    p.ChartName,
		"chart_project": p.ChartProject,
		"chart_version": version,
	}
	if comment != "" {
		out["comment"] = comment
	}
	return out
}

func actorSubject(u *models.User) string {
	if u == nil {
		return ""
	}
	return u.Subject
}

func actorName(u *models.User) string {
	if u == nil {
		return ""
	}
	return u.Name
}
