package store

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"console/pkg/models"
)

// TestPostgresStands covers what the in-memory store cannot: the one-default
// rule is a partial unique index, the cluster rule is a CHECK, and moving the
// default is a single UPDATE that has to satisfy the index on its own. Needs
// a scratch Postgres: set STORE_TEST_URL.
func TestPostgresStands(t *testing.T) {
	url := os.Getenv("STORE_TEST_URL")
	if url == "" {
		t.Skip("set STORE_TEST_URL to run the Postgres stands test")
	}
	ctx := context.Background()
	pg, err := NewPostgres(ctx, url, 5)
	if err != nil {
		t.Fatalf("NewPostgres: %v", err)
	}
	defer pg.Close()
	// Scratch databases are reused between runs: start from no stands.
	if _, err := pg.pool.Exec(ctx, `UPDATE requests SET stand_id = NULL; DELETE FROM stands`); err != nil {
		t.Fatalf("reset: %v", err)
	}

	dev := &models.Stand{ID: uuid.NewString(), Name: "dev", DefaultCluster: "in-cluster", Default: true}
	if err := pg.CreateStand(ctx, dev); err != nil {
		t.Fatalf("create: %v", err)
	}
	if dev.CreatedAt.IsZero() {
		t.Fatal("create must return the stored timestamps")
	}
	if err := pg.CreateStand(ctx, &models.Stand{ID: uuid.NewString(), Name: "dev", DefaultCluster: "x"}); !errors.Is(err, models.ErrConflict) {
		t.Fatalf("duplicate name: want ErrConflict, got %v", err)
	}
	if err := pg.CreateStand(ctx, &models.Stand{ID: uuid.NewString(), Name: "second-default", DefaultCluster: "x", Default: true}); !errors.Is(err, models.ErrConflict) {
		t.Fatalf("second default: want ErrConflict from the partial index, got %v", err)
	}
	if err := pg.CreateStand(ctx, &models.Stand{ID: uuid.NewString(), Name: "bad", DefaultCluster: "Bad Name"}); err == nil {
		t.Fatal("the CHECK constraint must refuse a cluster in the wrong shape")
	}

	edge := &models.Stand{ID: uuid.NewString(), Name: "edge", DefaultCluster: "edge"}
	if err := pg.CreateStand(ctx, edge); err != nil {
		t.Fatalf("create edge: %v", err)
	}
	if err := pg.SetDefaultStand(ctx, edge.ID); err != nil {
		t.Fatalf("move default: %v", err)
	}
	def, err := pg.DefaultStand(ctx)
	if err != nil || def.ID != edge.ID {
		t.Fatalf("default after move: %+v %v", def, err)
	}
	if err := pg.SetDefaultStand(ctx, uuid.NewString()); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("move to a missing stand: want ErrNotFound, got %v", err)
	}
	if err := pg.SetDefaultStand(ctx, "not-a-uuid"); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("move to a non-uuid: want ErrNotFound, got %v", err)
	}
	if def, _ := pg.DefaultStand(ctx); def == nil || def.ID != edge.ID {
		t.Fatal("a refused move must leave the default where it was")
	}

	if err := pg.UpdateStand(ctx, &models.Stand{ID: edge.ID, Name: "edge-2", DefaultCluster: "edge"}); err != nil {
		t.Fatalf("update: %v", err)
	}
	if err := pg.UpdateStand(ctx, &models.Stand{ID: uuid.NewString(), Name: "nobody", DefaultCluster: "x"}); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("update missing: want ErrNotFound, got %v", err)
	}
	if err := pg.UpdateStand(ctx, &models.Stand{ID: dev.ID, Name: "edge-2", DefaultCluster: "x"}); !errors.Is(err, models.ErrConflict) {
		t.Fatalf("rename onto a taken name: want ErrConflict, got %v", err)
	}

	list, err := pg.ListStands(ctx)
	if err != nil || len(list) != 2 || list[0].ID != edge.ID || !list[0].Default {
		t.Fatalf("list: %+v %v", list, err)
	}

	// Orphans: an order without a stand is attached by AdoptOrphanRequests and
	// read back with its stand.
	r := &models.Request{ID: uuid.NewString(), CreatedBy: "u", Team: "core", ChartProject: "p", ChartName: "c",
		ChartVersion: "1", ServiceName: "orphan-" + uuid.NewString()[:8], Cluster: "in-cluster", Status: models.StatusDraft}
	if err := pg.CreateRequest(ctx, r); err != nil {
		t.Fatalf("create request: %v", err)
	}
	n, err := pg.AdoptOrphanRequests(ctx, dev.ID)
	if err != nil || n < 1 {
		t.Fatalf("adopt: n=%d err=%v", n, err)
	}
	got, err := pg.GetRequest(ctx, r.ID)
	if err != nil || got.StandID != dev.ID {
		t.Fatalf("adopted request: stand=%q err=%v", got.StandID, err)
	}
	byStand, err := pg.ListRequests(ctx, RequestFilter{Admin: true, Stand: dev.ID})
	if err != nil || len(byStand) == 0 {
		t.Fatalf("list by stand: %d %v", len(byStand), err)
	}
	if byStand, err := pg.ListRequests(ctx, RequestFilter{Admin: true, Stand: "not-a-uuid"}); err != nil || len(byStand) != 0 {
		t.Fatalf("list by a non-uuid stand is empty, not an error: %d %v", len(byStand), err)
	}
	// Cleanup: leave the scratch database without the orders and stands made here.
	if _, err := pg.pool.Exec(ctx, `DELETE FROM requests WHERE id=$1`, r.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := pg.pool.Exec(ctx, `UPDATE requests SET stand_id = NULL; DELETE FROM stands`); err != nil {
		t.Fatal(err)
	}
}
