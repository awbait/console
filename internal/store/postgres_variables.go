package store

import (
	"context"

	"console/pkg/models"
)

// Platform variables: the named values a version document references as
// "{{.Vars.OPS}}". The whole table is read at once everywhere - it holds a
// couple of dozen rows the platform team writes by hand, and every reader (the
// order stamp, the constructor's hints, the admin page) wants all of them.
// The per-stand overrides come along in the same read, for the same reason.

func (p *Postgres) ListVariables(ctx context.Context) ([]*models.Variable, error) {
	rows, err := p.db.Query(ctx, `
		SELECT name, value, description, updated_by, updated_at
		FROM variables ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*models.Variable
	byName := map[string]*models.Variable{}
	for rows.Next() {
		var v models.Variable
		if err := rows.Scan(&v.Name, &v.Value, &v.Description, &v.UpdatedBy, &v.UpdatedAt); err != nil {
			return nil, err
		}
		v.Overrides = []models.VariableOverride{}
		out = append(out, &v)
		byName[v.Name] = &v
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return out, nil
	}
	// Overrides in the order the stands are listed, so the admin page shows
	// them under each variable the way the stands page shows the stands.
	orows, err := p.db.Query(ctx, `
		SELECT o.variable_name, o.stand_id::text, o.value, o.updated_by, o.updated_at
		FROM variable_overrides o JOIN stands s ON s.id = o.stand_id
		ORDER BY o.variable_name, s.is_default DESC, s.name`)
	if err != nil {
		return nil, err
	}
	defer orows.Close()
	for orows.Next() {
		var name string
		var o models.VariableOverride
		if err := orows.Scan(&name, &o.StandID, &o.Value, &o.UpdatedBy, &o.UpdatedAt); err != nil {
			return nil, err
		}
		if v := byName[name]; v != nil {
			v.Overrides = append(v.Overrides, o)
		}
	}
	return out, orows.Err()
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

// DeleteVariable takes the variable's overrides with it: the foreign key
// cascades, so one statement is the whole deletion.
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

// SetVariableOverride is one statement for both the first value on a stand and
// a changed one. A variable or a stand that does not exist fails the foreign
// key, which is the store's way of saying ErrNotFound.
func (p *Postgres) SetVariableOverride(ctx context.Context, name string, o *models.VariableOverride) error {
	err := p.db.QueryRow(ctx, `
		INSERT INTO variable_overrides (variable_name, stand_id, value, updated_by, updated_at)
		VALUES ($1,$2::uuid,$3,$4,NOW())
		ON CONFLICT (variable_name, stand_id) DO UPDATE
		SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
		RETURNING updated_at`,
		name, o.StandID, o.Value, o.UpdatedBy).Scan(&o.UpdatedAt)
	if isFKViolation(err) {
		return models.ErrNotFound
	}
	return err
}

func (p *Postgres) DeleteVariableOverride(ctx context.Context, name, standID string) error {
	tag, err := p.db.Exec(ctx, `
		DELETE FROM variable_overrides WHERE variable_name=$1 AND stand_id::text=$2`, name, standID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return models.ErrNotFound
	}
	return nil
}
