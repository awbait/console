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
	s.Send(ctx, st, Notification{
		Kind:        models.NotifyVersionApproved,
		SubjectType: models.SubjectVersion,
		SubjectID:   p.ID + "/" + version,
		Audience:    models.AudienceTeam,
		AudienceKey: p.OwnerTeam,
		Actor:       actorSubject(u),
		ActorName:   actorName(u),
		Payload:     versionPayload(p, version, ""),
		Level:       models.LevelInfo,
	})
}

func (s *Service) VersionRejected(ctx context.Context, st store.Store, p *models.ChartPublication, version, comment string, u *models.User) {
	s.Send(ctx, st, Notification{
		Kind:        models.NotifyVersionRejected,
		SubjectType: models.SubjectVersion,
		SubjectID:   p.ID + "/" + version,
		Audience:    models.AudienceTeam,
		AudienceKey: p.OwnerTeam,
		Actor:       actorSubject(u),
		ActorName:   actorName(u),
		Payload:     versionPayload(p, version, comment),
		Level:       models.LevelAttention,
	})
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
