package store

import (
	"context"
	"sort"

	"console/pkg/models"
)

func (m *Memory) ListVariables(ctx context.Context) ([]*models.Variable, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]*models.Variable, 0, len(m.variables))
	for _, v := range m.variables {
		cp := clone(v)
		cp.Overrides = m.overridesOf(v.Name)
		out = append(out, cp)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// overridesOf lists a variable's overrides the way the stands are listed: the
// default stand first, then by name. Caller holds the lock.
func (m *Memory) overridesOf(name string) []models.VariableOverride {
	out := make([]models.VariableOverride, 0, len(m.overrides[name]))
	for _, o := range m.overrides[name] {
		out = append(out, *o)
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := m.stands[out[i].StandID], m.stands[out[j].StandID]
		if a == nil || b == nil {
			return out[i].StandID < out[j].StandID
		}
		if a.Default != b.Default {
			return a.Default
		}
		return a.Name < b.Name
	})
	return out
}

func (m *Memory) UpsertVariable(ctx context.Context, v *models.Variable) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	v.UpdatedAt = m.stamp()
	cp := clone(v)
	cp.Overrides = nil // kept in their own map, assembled on read
	m.variables[v.Name] = cp
	return nil
}

func (m *Memory) DeleteVariable(ctx context.Context, name string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.variables[name]; !ok {
		return models.ErrNotFound
	}
	delete(m.variables, name)
	delete(m.overrides, name)
	return nil
}

func (m *Memory) SetVariableOverride(ctx context.Context, name string, o *models.VariableOverride) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.variables[name]; !ok {
		return models.ErrNotFound
	}
	if _, ok := m.stands[o.StandID]; !ok {
		return models.ErrNotFound
	}
	o.UpdatedAt = m.stamp()
	if m.overrides[name] == nil {
		m.overrides[name] = map[string]*models.VariableOverride{}
	}
	m.overrides[name][o.StandID] = clone(o)
	return nil
}

func (m *Memory) DeleteVariableOverride(ctx context.Context, name, standID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.overrides[name][standID]; !ok {
		return models.ErrNotFound
	}
	delete(m.overrides[name], standID)
	return nil
}
