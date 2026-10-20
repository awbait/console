package store

import (
	"context"
	"slices"
	"sort"
	"time"

	"console/pkg/models"
)

func (m *Memory) DailyCounts(ctx context.Context, since time.Time, loc *time.Location) ([]*models.DayCounts, error) {
	if loc == nil {
		loc = time.UTC
	}
	m.mu.Lock()
	defer m.mu.Unlock()

	days := map[string]*models.DayCounts{}
	day := func(at time.Time) *models.DayCounts {
		d := at.In(loc).Format("2006-01-02")
		c, ok := days[d]
		if !ok {
			c = &models.DayCounts{Day: d}
			days[d] = c
		}
		return c
	}
	// Same rules as Postgres: only what people did, and the events that make
	// an order count as new orders too.
	for _, e := range m.events {
		if e.CreatedAt.Before(since) || models.IsSystemActor(e.Actor) {
			continue
		}
		c := day(e.CreatedAt)
		c.Actions++
		if slices.Contains(models.NewOrderEvents, e.EventType) {
			c.NewOrders++
		}
	}
	seen := map[string]map[string]bool{}
	from := since.UTC().Truncate(time.Hour)
	for hour, people := range m.userHours {
		if hour.Before(from) {
			continue
		}
		d := day(hour).Day
		if seen[d] == nil {
			seen[d] = map[string]bool{}
		}
		for s := range people {
			seen[d][s] = true
		}
	}
	for d, people := range seen {
		days[d].ActiveUsers = len(people)
	}

	out := make([]*models.DayCounts, 0, len(days))
	for _, c := range days {
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Day < out[j].Day })
	return out, nil
}

func (m *Memory) CountLiveOrders(ctx context.Context) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, r := range m.requests {
		if r.DeletedAt == nil && r.Status != models.StatusDraft && r.Status != models.StatusDeleted {
			n++
		}
	}
	return n, nil
}

func (m *Memory) RecordOnline(ctx context.Context, at time.Time, online int) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, s := range m.online {
		if s.At.Equal(at) {
			s.Online = online
			return nil
		}
	}
	m.online = append(m.online, &models.OnlineSample{At: at, Online: online})
	sort.Slice(m.online, func(i, j int) bool { return m.online[i].At.Before(m.online[j].At) })
	return nil
}

func (m *Memory) OnlineSamples(ctx context.Context, since time.Time) ([]*models.OnlineSample, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []*models.OnlineSample
	for _, s := range m.online {
		if !s.At.Before(since) {
			out = append(out, clone(s))
		}
	}
	return out, nil
}

func (m *Memory) PruneBoardHistory(ctx context.Context, usersBefore, onlineBefore time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for hour := range m.userHours {
		if hour.Before(usersBefore) {
			delete(m.userHours, hour)
		}
	}
	kept := m.online[:0]
	for _, s := range m.online {
		if !s.At.Before(onlineBefore) {
			kept = append(kept, s)
		}
	}
	m.online = kept
	return nil
}

// recordUserHour notes the hour a person was seen in. Callers hold m.mu.
func (m *Memory) recordUserHour(subject string, seen time.Time) {
	if m.userHours == nil {
		m.userHours = map[time.Time]map[string]bool{}
	}
	hour := seen.UTC().Truncate(time.Hour)
	if m.userHours[hour] == nil {
		m.userHours[hour] = map[string]bool{}
	}
	m.userHours[hour][subject] = true
}
