package store

import (
	"context"
	"sort"

	"console/pkg/models"
)

func cloneJob(j *models.StandJob) *models.StandJob {
	c := *j
	c.Failures = append([]models.StandJobFailure(nil), j.Failures...)
	if c.Failures == nil {
		c.Failures = []models.StandJobFailure{}
	}
	return &c
}

func (m *Memory) CreateStandJob(ctx context.Context, j *models.StandJob) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.stands[j.StandID]; !ok {
		return models.ErrNotFound
	}
	for _, ex := range m.standJobs {
		if ex.StandID == j.StandID && ex.Status == models.StandJobRunning && j.Status == models.StandJobRunning {
			return models.ErrConflict
		}
	}
	j.CreatedAt = m.stamp()
	if j.Failures == nil {
		j.Failures = []models.StandJobFailure{}
	}
	m.standJobs[j.ID] = cloneJob(j)
	return nil
}

func (m *Memory) UpdateStandJob(ctx context.Context, j *models.StandJob) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.standJobs[j.ID]; !ok {
		return models.ErrNotFound
	}
	m.standJobs[j.ID] = cloneJob(j)
	return nil
}

func (m *Memory) GetStandJob(ctx context.Context, id string) (*models.StandJob, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	j, ok := m.standJobs[id]
	if !ok {
		return nil, models.ErrNotFound
	}
	return cloneJob(j), nil
}

func (m *Memory) ListStandJobs(ctx context.Context, standID string) ([]*models.StandJob, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []*models.StandJob{}
	for _, j := range m.standJobs {
		if j.StandID == standID {
			out = append(out, cloneJob(j))
		}
	}
	sort.SliceStable(out, func(i, k int) bool { return out[i].CreatedAt.After(out[k].CreatedAt) })
	return out, nil
}

func (m *Memory) ListRunningStandJobs(ctx context.Context) ([]*models.StandJob, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []*models.StandJob{}
	for _, j := range m.standJobs {
		if j.Status == models.StandJobRunning {
			out = append(out, cloneJob(j))
		}
	}
	sort.SliceStable(out, func(i, k int) bool { return out[i].CreatedAt.Before(out[k].CreatedAt) })
	return out, nil
}
