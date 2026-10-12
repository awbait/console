package store

import (
	"context"
	"sort"

	"console/pkg/models"
)

func (m *Memory) SaveStandChecks(ctx context.Context, standID string, results []*models.StandCheck, argoConnected *bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	st, ok := m.stands[standID]
	if !ok {
		return models.ErrNotFound
	}
	rows := make([]*models.StandCheck, 0, len(results))
	for _, r := range results {
		c := *r
		c.StandID = standID
		rows = append(rows, &c)
	}
	m.standChecks[standID] = rows
	if len(results) > 0 {
		t := results[0].CheckedAt
		st.CheckedAt = &t
	}
	if argoConnected != nil {
		st.ArgoConnected = *argoConnected
	}
	return nil
}

func (m *Memory) ListStandChecks(ctx context.Context, standID string) ([]*models.StandCheck, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]*models.StandCheck, 0, len(m.standChecks[standID]))
	for _, c := range m.standChecks[standID] {
		cc := *c
		out = append(out, &cc)
	}
	return out, nil
}

func (m *Memory) ListAllStandChecks(ctx context.Context) ([]*models.StandCheck, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []*models.StandCheck
	for _, rows := range m.standChecks {
		for _, c := range rows {
			cc := *c
			out = append(out, &cc)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].StandID != out[j].StandID {
			return out[i].StandID < out[j].StandID
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}
