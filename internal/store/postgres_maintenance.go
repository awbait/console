package store

import (
	"context"
	"errors"

	"console/pkg/models"
	"github.com/jackc/pgx/v5"
)

// Maintenance: a single-row table for the window (see migration 000036) and an
// append-only history beside it.

func (p *Postgres) GetMaintenance(ctx context.Context) (*models.MaintenanceWindow, error) {
	var w models.MaintenanceWindow
	err := p.db.QueryRow(ctx, `
		SELECT id::text, starts_at, ends_at, message, pause_background, auto_end,
		       updated_by, updated_by_name, updated_at
		FROM maintenance`).Scan(&w.ID, &w.StartsAt, &w.EndsAt, &w.Message, &w.PauseBackground,
		&w.AutoEnd, &w.UpdatedBy, &w.UpdatedByName, &w.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, models.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &w, nil
}

func (p *Postgres) SaveMaintenance(ctx context.Context, w *models.MaintenanceWindow) error {
	return p.db.QueryRow(ctx, `
		INSERT INTO maintenance (singleton, id, starts_at, ends_at, message, pause_background,
		                         auto_end, updated_by, updated_by_name, updated_at)
		VALUES (TRUE, $1::uuid, $2, $3, $4, $5, $6, $7, $8, NOW())
		ON CONFLICT (singleton) DO UPDATE
		SET id = EXCLUDED.id, starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at,
		    message = EXCLUDED.message, pause_background = EXCLUDED.pause_background,
		    auto_end = EXCLUDED.auto_end, updated_by = EXCLUDED.updated_by,
		    updated_by_name = EXCLUDED.updated_by_name, updated_at = NOW()
		RETURNING updated_at`,
		w.ID, w.StartsAt, w.EndsAt, w.Message, w.PauseBackground, w.AutoEnd,
		w.UpdatedBy, w.UpdatedByName).Scan(&w.UpdatedAt)
}

func (p *Postgres) ClearMaintenance(ctx context.Context, id string) error {
	tag, err := p.db.Exec(ctx, `DELETE FROM maintenance WHERE id::text = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return models.ErrNotFound
	}
	return nil
}

func (p *Postgres) AddMaintenanceEvent(ctx context.Context, e *models.MaintenanceEvent) error {
	return p.db.QueryRow(ctx, `
		INSERT INTO maintenance_events (window_id, action, actor, actor_name, starts_at, ends_at, message)
		VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
		RETURNING id, created_at`,
		e.WindowID, e.Action, e.Actor, e.ActorName, e.StartsAt, e.EndsAt, e.Message).Scan(&e.ID, &e.CreatedAt)
}

func (p *Postgres) ListMaintenanceEvents(ctx context.Context, limit int) ([]*models.MaintenanceEvent, error) {
	rows, err := p.db.Query(ctx, `
		SELECT id, window_id::text, action, actor, actor_name, starts_at, ends_at, message, created_at
		FROM maintenance_events ORDER BY created_at DESC, id DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*models.MaintenanceEvent{}
	for rows.Next() {
		var e models.MaintenanceEvent
		if err := rows.Scan(&e.ID, &e.WindowID, &e.Action, &e.Actor, &e.ActorName,
			&e.StartsAt, &e.EndsAt, &e.Message, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, &e)
	}
	return out, rows.Err()
}
