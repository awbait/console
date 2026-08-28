package store

import (
	"context"
	"sort"
	"time"

	"console/pkg/models"
)

// The user directory and the activity feed, in memory. Same contract as the
// Postgres pair (see postgres_activity.go): the directory grows by sign-ins,
// the feed is a read over the two journals, and only people appear in it.

func (m *Memory) TouchUser(ctx context.Context, u *models.PlatformUser) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	seen := u.LastSeen
	if seen.IsZero() {
		seen = m.stamp()
	}
	// An appearance is also when the portal learns that somebody is in a team or
	// holds a role: see Postgres, and Store.RecordAudiences for why the feed
	// needs it.
	m.recordAudiences(u.Subject, u.Teams, string(u.Role), seen)
	cur, ok := m.users[u.Subject]
	if !ok {
		cp := clone(u)
		cp.Teams = append([]string{}, u.Teams...)
		cp.FirstSeen, cp.LastSeen, cp.Visits = seen, seen, 1
		m.users[u.Subject] = cp
		*u = *clone(cp)
		return nil
	}
	// Same rule as Postgres: a token that omits a claim must not erase what an
	// earlier one carried.
	if u.Email != "" {
		cur.Email = u.Email
	}
	if u.Username != "" {
		cur.Username = u.Username
	}
	if u.Name != "" {
		cur.Name = u.Name
	}
	cur.Teams = append([]string{}, u.Teams...)
	cur.Role = u.Role
	cur.LastSeen = seen
	cur.Visits++
	*u = *clone(cur)
	return nil
}

func (m *Memory) ListUsers(ctx context.Context) ([]*models.PlatformUser, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]*models.PlatformUser, 0, len(m.users))
	for _, u := range m.users {
		cp := clone(u)
		cp.Teams = append([]string{}, u.Teams...)
		out = append(out, cp)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].LastSeen.After(out[j].LastSeen) })
	return out, nil
}

func (m *Memory) ListActivity(ctx context.Context, f ActivityFilter) ([]*models.ActivityEvent, error) {
	var out []*models.ActivityEvent
	for _, e := range m.activity(time.Time{}) {
		if f.Actor != "" && e.Actor != f.Actor {
			continue
		}
		if f.Team != "" && e.Team != f.Team {
			continue
		}
		// The page boundary follows the order, same as in Postgres.
		if !f.Cursor.IsZero() {
			if f.Oldest && !e.At.After(f.Cursor) {
				continue
			}
			if !f.Oldest && !e.At.Before(f.Cursor) {
				continue
			}
		}
		out = append(out, e)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if f.Oldest {
			return out[i].At.Before(out[j].At)
		}
		return out[i].At.After(out[j].At)
	})
	if n := activityLimit(f.Limit); len(out) > n {
		out = out[:n]
	}
	return out, nil
}

func (m *Memory) CountActivity(ctx context.Context, since time.Time) ([]*models.ActivityCount, error) {
	counts := map[[2]string]int{}
	for _, e := range m.activity(since) {
		counts[[2]string{e.EventType, e.Team}]++
	}
	out := make([]*models.ActivityCount, 0, len(counts))
	for k, n := range counts {
		out = append(out, &models.ActivityCount{EventType: k[0], Team: k[1], Count: n})
	}
	return out, nil
}

// activity folds both journals into one stream of what people did, dropping
// anything older than since (zero means all of it).
func (m *Memory) activity(since time.Time) []*models.ActivityEvent {
	m.mu.Lock()
	defer m.mu.Unlock()

	var out []*models.ActivityEvent
	for _, e := range m.events {
		r, ok := m.requests[e.RequestID]
		if !ok || models.IsSystemActor(e.Actor) || e.CreatedAt.Before(since) {
			continue
		}
		title := r.DisplayName
		if title == "" {
			title = r.ServiceName
		}
		out = append(out, &models.ActivityEvent{
			At: e.CreatedAt, Source: models.ActivityOrder, Actor: e.Actor,
			ActorName: m.actorName(e.Actor, e.ActorName), EventType: e.EventType,
			FromStatus: string(e.FromStatus), ToStatus: string(e.ToStatus),
			SubjectID: r.ID, Title: title, Team: r.Team,
		})
	}
	for _, e := range m.pubEvents {
		p, ok := m.pubs[e.PublicationID]
		if !ok || models.IsSystemActor(e.Actor) || e.CreatedAt.Before(since) {
			continue
		}
		out = append(out, &models.ActivityEvent{
			At: e.CreatedAt, Source: models.ActivityPublication, Actor: e.Actor,
			ActorName: m.actorName(e.Actor, ""), EventType: e.EventType,
			FromStatus: string(e.FromStatus), ToStatus: string(e.ToStatus),
			SubjectID: p.ID, Title: p.ChartProject + "/" + p.ChartName, Team: p.OwnerTeam,
		})
	}
	return out
}

// actorName prefers the name recorded with the event and falls back to the
// directory. Callers must hold m.mu.
func (m *Memory) actorName(subject, recorded string) string {
	if recorded != "" {
		return recorded
	}
	if u, ok := m.users[subject]; ok {
		return u.Name
	}
	return ""
}
