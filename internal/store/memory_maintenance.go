package store

import (
	"context"

	"console/pkg/models"
)

func (m *Memory) GetMaintenance(ctx context.Context) (*models.MaintenanceWindow, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.maintenance == nil {
		return nil, models.ErrNotFound
	}
	return cloneWindow(m.maintenance), nil
}

func (m *Memory) SaveMaintenance(ctx context.Context, w *models.MaintenanceWindow) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	w.UpdatedAt = m.stamp()
	m.maintenance = cloneWindow(w)
	return nil
}

func (m *Memory) ClearMaintenance(ctx context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.maintenance == nil || m.maintenance.ID != id {
		return models.ErrNotFound
	}
	m.maintenance = nil
	return nil
}

func (m *Memory) AddMaintenanceEvent(ctx context.Context, e *models.MaintenanceEvent) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	e.ID = int64(len(m.maintEvents) + 1)
	e.CreatedAt = m.stamp()
	m.maintEvents = append(m.maintEvents, clone(e))
	return nil
}

func (m *Memory) ListMaintenanceEvents(ctx context.Context, limit int) ([]*models.MaintenanceEvent, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []*models.MaintenanceEvent{}
	for i := len(m.maintEvents) - 1; i >= 0 && len(out) < limit; i-- {
		out = append(out, clone(m.maintEvents[i]))
	}
	return out, nil
}

// cloneWindow copies the end time too, so a caller moving it does not move the
// stored one.
func cloneWindow(w *models.MaintenanceWindow) *models.MaintenanceWindow {
	cp := *w
	if w.EndsAt != nil {
		t := *w.EndsAt
		cp.EndsAt = &t
	}
	return &cp
}
