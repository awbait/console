package store

import (
	"context"
	"encoding/json"
	"fmt"

	"console/pkg/models"
	"github.com/jackc/pgx/v5"
)

const standCheckCols = `stand_id, check_id, component, verdict, reason, facts, checked_at`

func scanStandCheck(row pgx.Row) (*models.StandCheck, error) {
	var c models.StandCheck
	var facts []byte
	if err := row.Scan(&c.StandID, &c.ID, &c.Component, &c.Verdict, &c.Reason, &facts, &c.CheckedAt); err != nil {
		return nil, err
	}
	if len(facts) > 0 {
		if err := json.Unmarshal(facts, &c.Facts); err != nil {
			return nil, fmt.Errorf("stand check facts: %w", err)
		}
	}
	return &c, nil
}

func (p *Postgres) SaveStandChecks(ctx context.Context, standID string, results []*models.StandCheck, argoConnected *bool) error {
	return p.Tx(ctx, func(s Store) error {
		tx := s.(*Postgres)
		// The stand's own row first: a stand that is not there is ErrNotFound,
		// not a foreign key violation from the rows below.
		var checkedAt any
		if len(results) > 0 {
			checkedAt = results[0].CheckedAt
		}
		tag, err := tx.db.Exec(ctx, `
			UPDATE stands
			SET checked_at = COALESCE($2, checked_at),
			    argo_connected = COALESCE($3, argo_connected)
			WHERE id = $1`, standID, checkedAt, argoConnected)
		if isInvalidUUID(err) {
			return models.ErrNotFound
		}
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return models.ErrNotFound
		}
		if _, err := tx.db.Exec(ctx, `DELETE FROM stand_checks WHERE stand_id = $1`, standID); err != nil {
			return err
		}
		for _, r := range results {
			facts, err := json.Marshal(r.Facts)
			if err != nil {
				return err
			}
			if r.Facts == nil {
				facts = []byte("{}")
			}
			if _, err := tx.db.Exec(ctx, `
				INSERT INTO stand_checks (`+standCheckCols+`)
				VALUES ($1,$2,$3,$4,$5,$6,$7)`,
				standID, r.ID, r.Component, r.Verdict, r.Reason, facts, r.CheckedAt); err != nil {
				return err
			}
		}
		return nil
	})
}

func (p *Postgres) ListStandChecks(ctx context.Context, standID string) ([]*models.StandCheck, error) {
	rows, err := p.db.Query(ctx, `SELECT `+standCheckCols+` FROM stand_checks WHERE stand_id = $1 ORDER BY check_id`, standID)
	if isInvalidUUID(err) {
		return []*models.StandCheck{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectStandChecks(rows)
}

func (p *Postgres) ListAllStandChecks(ctx context.Context) ([]*models.StandCheck, error) {
	rows, err := p.db.Query(ctx, `SELECT `+standCheckCols+` FROM stand_checks ORDER BY stand_id, check_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectStandChecks(rows)
}

func collectStandChecks(rows pgx.Rows) ([]*models.StandCheck, error) {
	out := []*models.StandCheck{}
	for rows.Next() {
		c, err := scanStandCheck(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
