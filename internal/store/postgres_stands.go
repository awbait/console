package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"console/pkg/models"
)

// Stands: the places orders are placed on. A few rows the platform team writes
// by hand, read whole by every reader (the order form, the list filter, the
// admin page), the way the variables are.

const standCols = `id, name, default_cluster, is_default, layout, git_path, mode, chart_registry, argo_connected, checked_at, storage_created, deleted_at, created_at, updated_at`

func scanStand(row pgx.Row) (*models.Stand, error) {
	var s models.Stand
	err := row.Scan(&s.ID, &s.Name, &s.DefaultCluster, &s.Default, &s.Layout, &s.GitPath, &s.Mode, &s.ChartRegistry,
		&s.ArgoConnected, &s.CheckedAt, &s.StorageCreated, &s.DeletedAt, &s.CreatedAt, &s.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) || isInvalidUUID(err) {
		return nil, models.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// standDefaults fills what a caller may leave empty the way the columns do:
// the group layout and the deploying mode, the shape every stand had before
// either was a choice.
func standDefaults(s *models.Stand) {
	if s.Layout == "" {
		s.Layout = models.LayoutGroup
	}
	if s.Mode == "" {
		s.Mode = models.ModeDeploy
	}
}

func (p *Postgres) ListStands(ctx context.Context) ([]*models.Stand, error) {
	// The default first, then by name: the selector and the admin page both
	// open on it.
	rows, err := p.db.Query(ctx, `SELECT `+standCols+` FROM stands WHERE deleted_at IS NULL ORDER BY is_default DESC, name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*models.Stand
	for rows.Next() {
		s, err := scanStand(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (p *Postgres) GetStand(ctx context.Context, id string) (*models.Stand, error) {
	return scanStand(p.db.QueryRow(ctx, `SELECT `+standCols+` FROM stands WHERE id=$1`, id))
}

func (p *Postgres) DefaultStand(ctx context.Context) (*models.Stand, error) {
	return scanStand(p.db.QueryRow(ctx, `SELECT `+standCols+` FROM stands WHERE is_default AND deleted_at IS NULL`))
}

// MarkStandStorageCreated records that the portal made the stand's group or
// repository in GitLab, so deleting the stand may remove it.
func (p *Postgres) MarkStandStorageCreated(ctx context.Context, id string) error {
	_, err := p.db.Exec(ctx, `UPDATE stands SET storage_created = TRUE WHERE id = $1`, id)
	if isInvalidUUID(err) {
		return models.ErrNotFound
	}
	return err
}

// DeleteStand marks the stand deleted and drops its variable values, in one
// transaction. The default stand is never deleted: the caller refuses first,
// and the WHERE keeps it so if it does not.
func (p *Postgres) DeleteStand(ctx context.Context, id string) error {
	return p.Tx(ctx, func(s Store) error {
		tx := s.(*Postgres)
		tag, err := tx.db.Exec(ctx, `
			UPDATE stands SET deleted_at = NOW(), updated_at = NOW()
			WHERE id = $1 AND deleted_at IS NULL AND NOT is_default`, id)
		if isInvalidUUID(err) {
			return models.ErrNotFound
		}
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return models.ErrNotFound
		}
		_, err = tx.db.Exec(ctx, `DELETE FROM variable_overrides WHERE stand_id = $1`, id)
		return err
	})
}

func (p *Postgres) CreateStand(ctx context.Context, s *models.Stand) error {
	standDefaults(s)
	err := p.db.QueryRow(ctx, `
		INSERT INTO stands (id, name, default_cluster, is_default, layout, git_path, mode, chart_registry)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING argo_connected, checked_at, created_at, updated_at`,
		s.ID, s.Name, s.DefaultCluster, s.Default, s.Layout, s.GitPath, s.Mode, s.ChartRegistry).Scan(&s.ArgoConnected, &s.CheckedAt, &s.CreatedAt, &s.UpdatedAt)
	if isUniqueViolation(err) {
		return models.ErrConflict
	}
	return err
}

func (p *Postgres) UpdateStand(ctx context.Context, s *models.Stand) error {
	standDefaults(s)
	err := p.db.QueryRow(ctx, `
		UPDATE stands SET name=$2, default_cluster=$3, layout=$4, git_path=$5, mode=$6, chart_registry=$7, updated_at=NOW()
		WHERE id=$1
		RETURNING is_default, argo_connected, checked_at, created_at, updated_at`,
		s.ID, s.Name, s.DefaultCluster, s.Layout, s.GitPath, s.Mode, s.ChartRegistry).Scan(&s.Default, &s.ArgoConnected, &s.CheckedAt, &s.CreatedAt, &s.UpdatedAt)
	if isUniqueViolation(err) {
		return models.ErrConflict
	}
	if errors.Is(err, pgx.ErrNoRows) || isInvalidUUID(err) {
		return models.ErrNotFound
	}
	return err
}

// SetDefaultStand moves the flag in one statement: the partial unique index
// allows one default row, so clearing and setting have to land together or the
// second write is refused by the index.
func (p *Postgres) SetDefaultStand(ctx context.Context, id string) error {
	// The target has to exist before anything is cleared: the statement below
	// matches the row that only loses the flag too, so its row count cannot
	// tell a missing target apart from a successful move.
	if _, err := p.GetStand(ctx, id); err != nil {
		return err
	}
	_, err := p.db.Exec(ctx, `
		UPDATE stands
		SET is_default = (id = $1),
		    updated_at = CASE WHEN is_default <> (id = $1) THEN NOW() ELSE updated_at END
		WHERE is_default OR id = $1`, id)
	return err
}

func (p *Postgres) AdoptOrphanRequests(ctx context.Context, standID string) (int, error) {
	tag, err := p.db.Exec(ctx, `UPDATE requests SET stand_id=$1 WHERE stand_id IS NULL`, standID)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}
