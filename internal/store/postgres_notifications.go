package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"console/pkg/models"
)

// Notifications in Postgres. One row per event; who sees it is a rule evaluated
// at read time (see visibleSQL), and "read" is per person - a row in
// notification_reads, or a cursor left behind by "read all".

// visibleSQL is the audience rule as a predicate. Its arguments are always the
// same three, in this order: the reader's subject, their teams, their role.
const visibleSQL = `(
	   (n.audience = 'all')
	or (n.audience = 'user' and n.audience_key = $1)
	or (n.audience = 'team' and n.audience_key = ANY($2))
	or (n.audience = 'role' and n.audience_key = $3)
)`

// readSQL is true when this reader has already seen the row: marked by hand, or
// covered by their "read all" cursor.
const readSQL = `(
	   exists (select 1 from notification_reads r where r.notification_id = n.id and r.subject = $1)
	or exists (select 1 from notification_cursor c where c.subject = $1 and n.created_at <= c.cleared_before)
)`

func (p *Postgres) AddNotification(ctx context.Context, n *models.Notification) error {
	var payload []byte
	if n.Payload != nil {
		b, err := json.Marshal(n.Payload)
		if err != nil {
			return fmt.Errorf("marshal notification payload: %w", err)
		}
		payload = b
	}
	// ON CONFLICT DO NOTHING on the dedup key: the same news twice is not an
	// error, it is the background loop coming round again.
	tag, err := p.db.Exec(ctx, `
		INSERT INTO notifications
			(id, kind, subject_type, subject_id, audience, audience_key, actor, actor_name, payload, level, dedup_key, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, COALESCE($12, NOW()))
		ON CONFLICT (dedup_key) DO NOTHING`,
		n.ID, n.Kind, n.SubjectType, n.SubjectID, string(n.Audience), n.AudienceKey,
		n.Actor, n.ActorName, payload, string(n.Level), nullStr(n.DedupKey), nullTime(n.CreatedAt))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return nil
	}
	if n.CreatedAt.IsZero() {
		// The row decides its own time; read it back so the caller can page from it.
		return p.db.QueryRow(ctx, `SELECT created_at FROM notifications WHERE id=$1`, n.ID).Scan(&n.CreatedAt)
	}
	return nil
}

func (p *Postgres) ListNotifications(ctx context.Context, f NotificationFilter) ([]*models.Notification, error) {
	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := p.db.Query(ctx, `
		SELECT n.id, n.kind, n.subject_type, n.subject_id, n.audience, n.audience_key,
		       n.actor, n.actor_name, n.payload, n.level, n.created_at, `+readSQL+` AS read
		FROM notifications n
		WHERE `+visibleSQL+`
		  AND ($4::timestamptz IS NULL OR n.created_at < $4)
		ORDER BY n.created_at DESC
		LIMIT $5`,
		f.Subject, teamList(f.Teams), f.Role, nullTime(f.Before), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*models.Notification
	for rows.Next() {
		var n models.Notification
		var payload []byte
		if err := rows.Scan(&n.ID, &n.Kind, &n.SubjectType, &n.SubjectID, &n.Audience, &n.AudienceKey,
			&n.Actor, &n.ActorName, &payload, &n.Level, &n.CreatedAt, &n.Read); err != nil {
			return nil, err
		}
		if len(payload) > 0 {
			_ = json.Unmarshal(payload, &n.Payload)
		}
		out = append(out, &n)
	}
	return out, rows.Err()
}

func (p *Postgres) CountUnread(ctx context.Context, f NotificationFilter) (int, error) {
	var count int
	err := p.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM notifications n
		WHERE `+visibleSQL+` AND NOT `+readSQL,
		f.Subject, teamList(f.Teams), f.Role).Scan(&count)
	return count, err
}

func (p *Postgres) MarkRead(ctx context.Context, id, subject string) error {
	// Marking twice is fine, and so is marking something that is not there any
	// more: a notification deleted by the retention sweep is already read.
	_, err := p.db.Exec(ctx, `
		INSERT INTO notification_reads (notification_id, subject)
		SELECT n.id, $1 FROM notifications n WHERE n.id = $2
		ON CONFLICT DO NOTHING`, subject, id)
	if isInvalidUUID(err) {
		return nil
	}
	return err
}

func (p *Postgres) MarkAllRead(ctx context.Context, subject string) error {
	_, err := p.db.Exec(ctx, `
		INSERT INTO notification_cursor (subject, cleared_before) VALUES ($1, NOW())
		ON CONFLICT (subject) DO UPDATE SET cleared_before = EXCLUDED.cleared_before`, subject)
	return err
}

func (p *Postgres) DeleteReadNotificationsBefore(ctx context.Context, cutoff time.Time) (int, error) {
	// Only what somebody has actually read: an unread notification stays until
	// it is read, however old it is.
	tag, err := p.db.Exec(ctx, `
		DELETE FROM notifications n
		WHERE n.created_at < $1
		  AND EXISTS (select 1 from notification_reads r where r.notification_id = n.id)`, cutoff)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

// teamList makes a nil slice an empty array: ANY(NULL) matches nothing in a way
// that reads as a bug when it happens.
func teamList(teams []string) []string {
	if teams == nil {
		return []string{}
	}
	return teams
}

// nullTime maps the zero time to SQL NULL, which is what "no bound" means for
// paging and for "let the row stamp itself".
func nullTime(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t
}
