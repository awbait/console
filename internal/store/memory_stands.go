package store

import (
	"context"
	"sort"

	"console/pkg/models"
)

func (m *Memory) ListStands(ctx context.Context) ([]*models.Stand, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]*models.Stand, 0, len(m.stands))
	for _, s := range m.stands {
		out = append(out, clone(s))
	}
	// The default first, then by name, as Postgres orders them.
	sort.Slice(out, func(i, j int) bool {
		if out[i].Default != out[j].Default {
			return out[i].Default
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

func (m *Memory) GetStand(ctx context.Context, id string) (*models.Stand, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.stands[id]
	if !ok {
		return nil, models.ErrNotFound
	}
	return clone(s), nil
}

func (m *Memory) DefaultStand(ctx context.Context) (*models.Stand, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, s := range m.stands {
		if s.Default {
			return clone(s), nil
		}
	}
	return nil, models.ErrNotFound
}

func (m *Memory) CreateStand(ctx context.Context, s *models.Stand) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, ex := range m.stands {
		if ex.Name == s.Name || (s.Default && ex.Default) {
			return models.ErrConflict
		}
	}
	now := m.stamp()
	s.CreatedAt, s.UpdatedAt = now, now
	m.stands[s.ID] = clone(s)
	return nil
}

func (m *Memory) UpdateStand(ctx context.Context, s *models.Stand) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cur, ok := m.stands[s.ID]
	if !ok {
		return models.ErrNotFound
	}
	for id, ex := range m.stands {
		if id != s.ID && ex.Name == s.Name {
			return models.ErrConflict
		}
	}
	cur.Name, cur.DefaultCluster = s.Name, s.DefaultCluster
	cur.UpdatedAt = m.stamp()
	*s = *clone(cur)
	return nil
}

func (m *Memory) SetDefaultStand(ctx context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	target, ok := m.stands[id]
	if !ok {
		return models.ErrNotFound
	}
	now := m.stamp()
	for _, s := range m.stands {
		if s.Default && s.ID != id {
			s.Default = false
			s.UpdatedAt = now
		}
	}
	if !target.Default {
		target.Default = true
		target.UpdatedAt = now
	}
	return nil
}

func (m *Memory) AdoptOrphanRequests(ctx context.Context, standID string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, r := range m.requests {
		if r.StandID == "" {
			r.StandID = standID
			n++
		}
	}
	return n, nil
}
