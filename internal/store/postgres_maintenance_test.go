package store

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"console/pkg/models"
	"github.com/google/uuid"
)

// TestPostgresMaintenance covers what the in-memory store cannot: the window is
// one row by a singleton key and ON CONFLICT, its times are held by CHECK
// constraints, and clearing is by the window's own id. Requires a scratch
// Postgres: set STORE_TEST_URL.
func TestPostgresMaintenance(t *testing.T) {
	url := os.Getenv("STORE_TEST_URL")
	if url == "" {
		t.Skip("set STORE_TEST_URL to run the Postgres maintenance test")
	}
	ctx := context.Background()
	pg, err := NewPostgres(ctx, url, 5)
	if err != nil {
		t.Fatalf("NewPostgres: %v", err)
	}
	defer pg.Close()
	if _, err := pg.db.Exec(ctx, `DELETE FROM maintenance; DELETE FROM maintenance_events`); err != nil {
		t.Fatal(err)
	}

	if _, err := pg.GetMaintenance(ctx); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("empty: %v", err)
	}
	start := time.Now().UTC().Truncate(time.Second)
	end := start.Add(time.Hour)
	w := &models.MaintenanceWindow{
		ID: uuid.NewString(), StartsAt: start, EndsAt: &end, Message: "DB",
		PauseBackground: true, UpdatedBy: "u1", UpdatedByName: "U One",
	}
	if err := pg.SaveMaintenance(ctx, w); err != nil {
		t.Fatalf("save: %v", err)
	}
	if w.UpdatedAt.IsZero() {
		t.Fatal("save must return the stored timestamp")
	}
	// A second save is the same row, with a new id when a new window replaces it.
	second := *w
	second.ID = uuid.NewString()
	second.EndsAt = nil
	if err := pg.SaveMaintenance(ctx, &second); err != nil {
		t.Fatalf("replace: %v", err)
	}
	got, err := pg.GetMaintenance(ctx)
	if err != nil || got.ID != second.ID || got.EndsAt != nil || !got.StartsAt.Equal(start) || !got.PauseBackground {
		t.Fatalf("read back: %+v %v", got, err)
	}

	// The constraints: an end before the start, an auto end with no end.
	early := start.Add(-time.Minute)
	if err := pg.SaveMaintenance(ctx, &models.MaintenanceWindow{ID: uuid.NewString(), StartsAt: start, EndsAt: &early}); err == nil {
		t.Fatal("an end before the start must be refused")
	}
	if err := pg.SaveMaintenance(ctx, &models.MaintenanceWindow{ID: uuid.NewString(), StartsAt: start, AutoEnd: true}); err == nil {
		t.Fatal("an auto end without an end must be refused")
	}

	if err := pg.ClearMaintenance(ctx, w.ID); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("clearing a window that is no longer there: %v", err)
	}
	if err := pg.ClearMaintenance(ctx, second.ID); err != nil {
		t.Fatalf("clear: %v", err)
	}
	if _, err := pg.GetMaintenance(ctx); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("after clear: %v", err)
	}

	for _, a := range []string{models.MaintenanceStartedAction, models.MaintenanceEndedAction} {
		if err := pg.AddMaintenanceEvent(ctx, &models.MaintenanceEvent{WindowID: second.ID, Action: a, StartsAt: &start, Actor: "u1"}); err != nil {
			t.Fatalf("event: %v", err)
		}
	}
	ev, err := pg.ListMaintenanceEvents(ctx, 10)
	if err != nil || len(ev) != 2 || ev[0].Action != models.MaintenanceEndedAction || ev[1].EndsAt != nil {
		t.Fatalf("history newest first: %+v %v", ev, err)
	}
}
