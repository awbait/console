package store

import (
	"context"
	"errors"
	"os"
	"testing"

	"console/pkg/models"
)

// TestPostgresTxAtomicity verifies that Tx commits on success and rolls back on
// error. Requires a scratch Postgres: set STORE_TEST_URL, e.g.
//
//	STORE_TEST_URL=postgres://portal:portal@localhost:5432/store_tx_test?sslmode=disable
func TestPostgresTxAtomicity(t *testing.T) {
	url := os.Getenv("STORE_TEST_URL")
	if url == "" {
		t.Skip("set STORE_TEST_URL to run the Postgres store transaction test")
	}
	ctx := context.Background()
	pg, err := NewPostgres(ctx, url, 5)
	if err != nil {
		t.Fatalf("NewPostgres: %v", err)
	}
	defer pg.Close()

	r := &models.Request{
		ID: "11111111-1111-1111-1111-111111111111", CreatedBy: "u", CreatedByName: "U", Team: "core",
		ChartProject: "platform", ChartName: "postgres", ChartVersion: "1",
		ServiceName: "svc", ValuesYAML: "{}", Status: models.StatusDraft,
	}
	if err := pg.CreateRequest(ctx, r); err != nil {
		t.Fatalf("CreateRequest: %v", err)
	}

	// Rollback: the update inside the failed Tx must not persist.
	sentinel := errors.New("boom")
	r.Status = models.StatusMRCreated
	if err := pg.Tx(ctx, func(tx Store) error {
		if err := tx.UpdateRequest(ctx, r); err != nil {
			return err
		}
		return sentinel
	}); !errors.Is(err, sentinel) {
		t.Fatalf("Tx error = %v, want sentinel", err)
	}
	got, _ := pg.GetRequest(ctx, r.ID)
	if got.Status != models.StatusDraft {
		t.Fatalf("rollback failed: status = %s, want DRAFT", got.Status)
	}

	// Commit: update + event persist together.
	r = got
	r.Status = models.StatusMRCreated
	if err := pg.Tx(ctx, func(tx Store) error {
		if err := tx.UpdateRequest(ctx, r); err != nil {
			return err
		}
		return tx.AddEvent(ctx, &models.RequestEvent{RequestID: r.ID, EventType: "status_changed"})
	}); err != nil {
		t.Fatalf("commit Tx: %v", err)
	}
	got, _ = pg.GetRequest(ctx, r.ID)
	if got.Status != models.StatusMRCreated {
		t.Fatalf("commit failed: status = %s", got.Status)
	}
	evs, _ := pg.ListEvents(ctx, r.ID)
	if len(evs) == 0 {
		t.Fatalf("commit failed: no audit event persisted")
	}
}
