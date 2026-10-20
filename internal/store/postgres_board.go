package store

import (
	"context"
	"time"

	"console/pkg/models"
)

// pgZone is the name Postgres knows a location by. time.Local has no IANA
// name of its own ("Local"), so it is read as UTC rather than sent to the
// database as a zone it would reject.
func pgZone(loc *time.Location) string {
	if loc == nil || loc == time.Local || loc.String() == "" {
		return "UTC"
	}
	return loc.String()
}

func (p *Postgres) DailyCounts(ctx context.Context, since time.Time, loc *time.Location) ([]*models.DayCounts, error) {
	zone := pgZone(loc)
	days := map[string]*models.DayCounts{}
	day := func(d string) *models.DayCounts {
		c, ok := days[d]
		if !ok {
			c = &models.DayCounts{Day: d}
			days[d] = c
		}
		return c
	}

	// Order events: a person's event counts as an action, and the ones that
	// make an order count as a new order too. An empty actor is the platform,
	// like the names in SystemActors (see models.IsSystemActor).
	rows, err := p.db.Query(ctx, `
		SELECT to_char(created_at AT TIME ZONE $2, 'YYYY-MM-DD') AS day,
		       count(*) FILTER (WHERE event_type = ANY($3)),
		       count(*)
		FROM request_events
		WHERE created_at >= $1
		  AND COALESCE(actor, '') <> '' AND NOT (actor = ANY($4))
		GROUP BY 1`, since, zone, models.NewOrderEvents, models.SystemActors())
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var d string
		var created, actions int
		if err := rows.Scan(&d, &created, &actions); err != nil {
			rows.Close()
			return nil, err
		}
		c := day(d)
		c.NewOrders, c.Actions = created, actions
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// People: an hour of presence lands on the day it falls in, in the
	// reader's zone, and a person counts once per day however many hours.
	rows, err = p.db.Query(ctx, `
		SELECT to_char(hour AT TIME ZONE $2, 'YYYY-MM-DD') AS day, count(DISTINCT subject)
		FROM user_hours
		WHERE hour >= date_trunc('hour', $1::timestamptz)
		GROUP BY 1`, since, zone)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var d string
		var n int
		if err := rows.Scan(&d, &n); err != nil {
			return nil, err
		}
		day(d).ActiveUsers = n
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := make([]*models.DayCounts, 0, len(days))
	for _, c := range days {
		out = append(out, c)
	}
	return out, nil
}

func (p *Postgres) CountLiveOrders(ctx context.Context) (int, error) {
	var n int
	err := p.db.QueryRow(ctx, `
		SELECT count(*) FROM requests
		WHERE deleted_at IS NULL AND status NOT IN ($1, $2)`,
		string(models.StatusDraft), string(models.StatusDeleted)).Scan(&n)
	return n, err
}

func (p *Postgres) RecordOnline(ctx context.Context, at time.Time, online int) error {
	// A second sample for the same moment (two leaders for a beat during a
	// handover) replaces the first rather than failing.
	_, err := p.db.Exec(ctx, `
		INSERT INTO online_samples (at, online) VALUES ($1, $2)
		ON CONFLICT (at) DO UPDATE SET online = EXCLUDED.online`, at, online)
	return err
}

func (p *Postgres) OnlineSamples(ctx context.Context, since time.Time) ([]*models.OnlineSample, error) {
	rows, err := p.db.Query(ctx, `
		SELECT at, online FROM online_samples WHERE at >= $1 ORDER BY at`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*models.OnlineSample
	for rows.Next() {
		s := &models.OnlineSample{}
		if err := rows.Scan(&s.At, &s.Online); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (p *Postgres) PruneBoardHistory(ctx context.Context, usersBefore, onlineBefore time.Time) error {
	if _, err := p.db.Exec(ctx, `DELETE FROM user_hours WHERE hour < $1`, usersBefore); err != nil {
		return err
	}
	_, err := p.db.Exec(ctx, `DELETE FROM online_samples WHERE at < $1`, onlineBefore)
	return err
}

// recordUserHour notes the hour a person was seen in. Hours are cut in UTC:
// the reader's zone is applied when they are summed into days.
func (p *Postgres) recordUserHour(ctx context.Context, subject string, seen time.Time) error {
	_, err := p.db.Exec(ctx, `
		INSERT INTO user_hours (hour, subject) VALUES ($1, $2)
		ON CONFLICT DO NOTHING`, seen.UTC().Truncate(time.Hour), subject)
	return err
}
