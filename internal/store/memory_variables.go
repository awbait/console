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
		out = append(out, clone(v))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func (m *Memory) UpsertVariable(ctx context.Context, v *models.Variable) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	v.UpdatedAt = m.stamp()
	m.variables[v.Name] = clone(v)
	return nil
}

func (m *Memory) DeleteVariable(ctx context.Context, name string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.variables[name]; !ok {
		return models.ErrNotFound
	}
	delete(m.variables, name)
	return nil
}
