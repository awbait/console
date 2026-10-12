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

const standCols = `id, name, default_cluster, is_default, created_at, updated_at`

func scanStand(row pgx.Row) (*models.Stand, error) {
	var s models.Stand
	err := row.Scan(&s.ID, &s.Name, &s.DefaultCluster, &s.Default, &s.CreatedAt, &s.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) || isInvalidUUID(err) {
		return nil, models.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func (p *Postgres) ListStands(ctx context.Context) ([]*models.Stand, error) {
	// The default first, then by name: the selector and the admin page both
	// open on it.
	rows, err := p.db.Query(ctx, `SELECT `+standCols+` FROM stands ORDER BY is_default DESC, name`)
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
	return scanStand(p.db.QueryRow(ctx, `SELECT `+standCols+` FROM stands WHERE is_default`))
}

func (p *Postgres) CreateStand(ctx context.Context, s *models.Stand) error {
	err := p.db.QueryRow(ctx, `
		INSERT INTO stands (id, name, default_cluster, is_default)
		VALUES ($1,$2,$3,$4)
		RETURNING created_at, updated_at`,
		s.ID, s.Name, s.DefaultCluster, s.Default).Scan(&s.CreatedAt, &s.UpdatedAt)
	if isUniqueViolation(err) {
		return models.ErrConflict
	}
	return err
}

func (p *Postgres) UpdateStand(ctx context.Context, s *models.Stand) error {
	err := p.db.QueryRow(ctx, `
		UPDATE stands SET name=$2, default_cluster=$3, updated_at=NOW()
		WHERE id=$1
		RETURNING is_default, created_at, updated_at`,
		s.ID, s.Name, s.DefaultCluster).Scan(&s.Default, &s.CreatedAt, &s.UpdatedAt)
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
