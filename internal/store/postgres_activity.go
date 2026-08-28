package store

import (
	"context"
	"time"

	"console/pkg/models"
)

// The user directory and the activity feed in Postgres. Neither is an audit
// trail: the directory is a by-product of signing in, and the feed is a read
// over the two journals that already exist.

// defaultActivityLimit bounds a feed read whose caller did not ask for a size.
const defaultActivityLimit = 50

// maxActivityLimit is the most a caller can ask for in one read of the feed.
const maxActivityLimit = 500

func (p *Postgres) TouchUser(ctx context.Context, u *models.PlatformUser) error {
	// An empty field in a fresh token must not erase what an earlier one
	// carried: Keycloak clients differ in which claims they release, and a
	// person whose name is known should not lose it to a token that omits it.
	if err := p.db.QueryRow(ctx, `
		INSERT INTO users (subject, email, username, name, teams, role, first_seen, last_seen, visits)
		VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7, NOW()), COALESCE($7, NOW()), 1)
		ON CONFLICT (subject) DO UPDATE SET
			email     = COALESCE(NULLIF(EXCLUDED.email,''), users.email),
			username  = COALESCE(NULLIF(EXCLUDED.username,''), users.username),
			name      = COALESCE(NULLIF(EXCLUDED.name,''), users.name),
			teams     = EXCLUDED.teams,
			role      = EXCLUDED.role,
			last_seen = EXCLUDED.last_seen,
			visits    = users.visits + 1
		RETURNING first_seen, last_seen, visits`,
		u.Subject, u.Email, u.Username, u.Name, teamList(u.Teams), string(u.Role), nullTime(u.LastSeen)).
		Scan(&u.FirstSeen, &u.LastSeen, &u.Visits); err != nil {
		return err
	}
	// An appearance is also when the portal learns that somebody is in a team or
	// holds a role. Recorded here rather than only when they open the bell, so
	// that being around for a week without looking at it does not cost the week's
	// news (see Store.RecordAudiences).
	return p.RecordAudiences(ctx, u.Subject, u.Teams, string(u.Role), u.LastSeen)
}

func (p *Postgres) ListUsers(ctx context.Context) ([]*models.PlatformUser, error) {
	rows, err := p.db.Query(ctx, `
		SELECT subject, email, username, name, teams, role, first_seen, last_seen, visits
		FROM users ORDER BY last_seen DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*models.PlatformUser
	for rows.Next() {
		var u models.PlatformUser
		if err := rows.Scan(&u.Subject, &u.Email, &u.Username, &u.Name, &u.Teams, &u.Role,
			&u.FirstSeen, &u.LastSeen, &u.Visits); err != nil {
			return nil, err
		}
		if u.Teams == nil {
			u.Teams = []string{}
		}
		out = append(out, &u)
	}
	return out, rows.Err()
}

// activityFeedSQL reads both journals as one stream of what people did.
//
// Its arguments are always the same four: $1 the actors that are not people
// (excluded - see models.IsSystemActor), $2 the oldest event to include or NULL
// for all of them, $3 one person or '' for everyone, $4 one team or '' for all
// of them.
//
// The actor's name is taken from the event when it recorded one (orders do,
// since migration 000017) and from the directory otherwise, so publication
// events, which never carried a name, still show a person rather than a UUID.
const activityFeedSQL = `
	SELECT e.created_at AS at, 'order' AS source, e.actor AS actor,
	       COALESCE(NULLIF(e.actor_name,''), pu.name, '') AS actor_name,
	       e.event_type AS event_type, COALESCE(e.from_status,'') AS from_status,
	       COALESCE(e.to_status,'') AS to_status, r.id::text AS subject_id,
	       COALESCE(NULLIF(r.display_name,''), r.service_name) AS title,
	       r.team AS team
	FROM request_events e
	JOIN requests r ON r.id = e.request_id
	LEFT JOIN users pu ON pu.subject = e.actor
	WHERE COALESCE(e.actor,'') <> '' AND NOT (e.actor = ANY($1))
	  AND ($2::timestamptz IS NULL OR e.created_at >= $2)
	  AND ($3 = '' OR e.actor = $3)
	  AND ($4 = '' OR r.team = $4)
	UNION ALL
	SELECT pe.created_at, 'publication', pe.actor,
	       COALESCE(pu.name, ''), pe.event_type, COALESCE(pe.from_status,''),
	       COALESCE(pe.to_status,''), cp.id::text,
	       cp.chart_project || '/' || cp.chart_name, cp.owner_team
	FROM publication_events pe
	JOIN chart_publications cp ON cp.id = pe.publication_id
	LEFT JOIN users pu ON pu.subject = pe.actor
	WHERE COALESCE(pe.actor,'') <> '' AND NOT (pe.actor = ANY($1))
	  AND ($2::timestamptz IS NULL OR pe.created_at >= $2)
	  AND ($3 = '' OR pe.actor = $3)
	  AND ($4 = '' OR cp.owner_team = $4)`

func (p *Postgres) ListActivity(ctx context.Context, f ActivityFilter) ([]*models.ActivityEvent, error) {
	// The page boundary and the order have to agree: reading earliest-first
	// continues past the cursor, reading newest-first continues before it.
	order, page := "DESC", "($6::timestamptz IS NULL OR at < $6)"
	if f.Oldest {
		order, page = "ASC", "($6::timestamptz IS NULL OR at > $6)"
	}
	rows, err := p.db.Query(ctx, `
		SELECT at, source, actor, actor_name, event_type, from_status, to_status, subject_id, title, team
		FROM (`+activityFeedSQL+`) feed
		WHERE `+page+`
		ORDER BY at `+order+`
		LIMIT $5`, models.SystemActors(), nil, f.Actor, f.Team, activityLimit(f.Limit), nullTime(f.Cursor))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*models.ActivityEvent
	for rows.Next() {
		var e models.ActivityEvent
		if err := rows.Scan(&e.At, &e.Source, &e.Actor, &e.ActorName, &e.EventType,
			&e.FromStatus, &e.ToStatus, &e.SubjectID, &e.Title, &e.Team); err != nil {
			return nil, err
		}
		out = append(out, &e)
	}
	return out, rows.Err()
}

func (p *Postgres) CountActivity(ctx context.Context, since time.Time) ([]*models.ActivityCount, error) {
	rows, err := p.db.Query(ctx, `
		SELECT event_type, team, COUNT(*)
		FROM (`+activityFeedSQL+`) feed
		GROUP BY event_type, team`, models.SystemActors(), nullTime(since), "", "")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*models.ActivityCount
	for rows.Next() {
		var c models.ActivityCount
		if err := rows.Scan(&c.EventType, &c.Team, &c.Count); err != nil {
			return nil, err
		}
		out = append(out, &c)
	}
	return out, rows.Err()
}

// activityLimit clamps what a caller asked the feed for.
func activityLimit(limit int) int {
	switch {
	case limit <= 0:
		return defaultActivityLimit
	case limit > maxActivityLimit:
		return maxActivityLimit
	default:
		return limit
	}
}
