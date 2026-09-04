package store

import (
	"context"

	"console/pkg/models"
)

// Platform variables: the named values a version document references as
// "{{.Vars.OPS}}". The whole table is read at once everywhere - it holds a
// couple of dozen rows the platform team writes by hand, and every reader (the
// order stamp, the constructor's hints, the admin page) wants all of them.

func (p *Postgres) ListVariables(ctx context.Context) ([]*models.Variable, error) {
	rows, err := p.db.Query(ctx, `
		SELECT name, value, description, updated_by, updated_at
		FROM variables ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*models.Variable
	for rows.Next() {
		var v models.Variable
		if err := rows.Scan(&v.Name, &v.Value, &v.Description, &v.UpdatedBy, &v.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, &v)
	}
	return out, rows.Err()
}

func (p *Postgres) UpsertVariable(ctx context.Context, v *models.Variable) error {
	return p.db.QueryRow(ctx, `
		INSERT INTO variables (name, value, description, updated_by, updated_at)
		VALUES ($1,$2,$3,$4,NOW())
		ON CONFLICT (name) DO UPDATE
		SET value = EXCLUDED.value, description = EXCLUDED.description,
		    updated_by = EXCLUDED.updated_by, updated_at = NOW()
		RETURNING updated_at`,
		v.Name, v.Value, v.Description, v.UpdatedBy).Scan(&v.UpdatedAt)
}

func (p *Postgres) DeleteVariable(ctx context.Context, name string) error {
	tag, err := p.db.Exec(ctx, `DELETE FROM variables WHERE name=$1`, name)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return models.ErrNotFound
	}
	return nil
}
