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

const standCols = `id, name, default_cluster, is_default, layout, git_path, mode, chart_registry, git_url, argocd_namespace, argocd_project, argocd_git_path, argo_connected, checked_at, storage_created, deleted_at, created_at, updated_at`

func scanStand(row pgx.Row) (*models.Stand, error) {
	var s models.Stand
	err := row.Scan(&s.ID, &s.Name, &s.DefaultCluster, &s.Default, &s.Layout, &s.GitPath, &s.Mode, &s.ChartRegistry, &s.GitURL, &s.ArgoNamespace, &s.ArgoProject, &s.ArgoGitPath,
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
		INSERT INTO stands (id, name, default_cluster, is_default, layout, git_path, mode, chart_registry, git_url, argocd_namespace, argocd_project, argocd_git_path)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		RETURNING argo_connected, checked_at, created_at, updated_at`,
		s.ID, s.Name, s.DefaultCluster, s.Default, s.Layout, s.GitPath, s.Mode, s.ChartRegistry, s.GitURL, s.ArgoNamespace, s.ArgoProject, s.ArgoGitPath).Scan(&s.ArgoConnected, &s.CheckedAt, &s.CreatedAt, &s.UpdatedAt)
	if isUniqueViolation(err) {
		return models.ErrConflict
	}
	return err
}

func (p *Postgres) UpdateStand(ctx context.Context, s *models.Stand) error {
	standDefaults(s)
	err := p.db.QueryRow(ctx, `
		UPDATE stands SET name=$2, default_cluster=$3, layout=$4, git_path=$5, mode=$6, chart_registry=$7, git_url=$8, argocd_namespace=$9, argocd_project=$10, argocd_git_path=$11, updated_at=NOW()
		WHERE id=$1
		RETURNING is_default, argo_connected, checked_at, created_at, updated_at`,
		s.ID, s.Name, s.DefaultCluster, s.Layout, s.GitPath, s.Mode, s.ChartRegistry, s.GitURL, s.ArgoNamespace, s.ArgoProject, s.ArgoGitPath).Scan(&s.Default, &s.ArgoConnected, &s.CheckedAt, &s.CreatedAt, &s.UpdatedAt)
	if isUniqueViolation(err) {
		return models.ErrConflict
	}
	if errors.Is(err, pgx.ErrNoRows) || isInvalidUUID(err) {
		return models.ErrNotFound
	}
	return err
}

// SetDefaultStand moves the default flag inside a transaction in two ordered
// updates: clear the previous default first, then mark the target. A single
// UPDATE violates the non-deferrable partial unique index uniq_default_stand
// whenever PostgreSQL scans the target tuple before the old default tuple.
func (p *Postgres) SetDefaultStand(ctx context.Context, id string) error {
	return p.Tx(ctx, func(s Store) error {
		tp := s.(*Postgres)
		if _, err := tp.db.Exec(ctx, `
			UPDATE stands
			SET is_default = FALSE, updated_at = NOW()
			WHERE is_default AND id <> $1`, id); err != nil {
			if isInvalidUUID(err) {
				return models.ErrNotFound
			}
			return err
		}
		tag, err := tp.db.Exec(ctx, `
			UPDATE stands
			SET is_default = TRUE,
			    updated_at = CASE WHEN NOT is_default THEN NOW() ELSE updated_at END
			WHERE id = $1 AND deleted_at IS NULL`, id)
		if isInvalidUUID(err) {
			return models.ErrNotFound
		}
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return models.ErrNotFound
		}
		return nil
	})
}

func (p *Postgres) AdoptOrphanRequests(ctx context.Context, standID string) (int, error) {
	tag, err := p.db.Exec(ctx, `UPDATE requests SET stand_id=$1 WHERE stand_id IS NULL`, standID)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}
