package store

import (
	"context"
	"errors"
	"os"
	"testing"

	"console/pkg/models"
	"github.com/google/uuid"
)

// Two stands may name different clusters alike, so an order and its copy on
// another stand share every field of the unique keys but the stand. Both keys
// let them be; on one stand they still collide. Needs a scratch Postgres: set
// STORE_TEST_URL.
func TestPostgresOrderIdentityPerStand(t *testing.T) {
	url := os.Getenv("STORE_TEST_URL")
	if url == "" {
		t.Skip("set STORE_TEST_URL to run the Postgres order identity test")
	}
	ctx := context.Background()
	pg, err := NewPostgres(ctx, url, 5)
	if err != nil {
		t.Fatalf("NewPostgres: %v", err)
	}
	defer pg.Close()

	var stands []*models.Stand
	for _, n := range []string{"idp", "edp"} {
		st := &models.Stand{ID: uuid.NewString(), Name: n + "-" + uuid.NewString()[:8], DefaultCluster: "in-cluster"}
		if err := pg.CreateStand(ctx, st); err != nil {
			t.Fatalf("create stand: %v", err)
		}
		stands = append(stands, st)
	}
	var ids []string
	defer func() {
		for _, id := range ids {
			_, _ = pg.pool.Exec(ctx, `DELETE FROM requests WHERE id=$1`, id)
		}
		for _, st := range stands {
			_, _ = pg.pool.Exec(ctx, `DELETE FROM stands WHERE id=$1`, st.ID)
		}
	}()
	service := "svc-" + uuid.NewString()[:8]
	order := func(standID, identity string) *models.Request {
		r := &models.Request{
			ID: uuid.NewString(), CreatedBy: "u", CreatedByName: "U", Team: "core",
			ChartProject: "platform", ChartName: "postgres", ChartVersion: "1",
			ServiceName: service, StandID: standID, Cluster: "in-cluster", Namespace: "db",
			ResourceIdentity: identity, ValuesYAML: "{}", Status: models.StatusDraft,
		}
		ids = append(ids, r.ID)
		return r
	}

	if err := pg.CreateRequest(ctx, order(stands[0].ID, "main")); err != nil {
		t.Fatalf("original: %v", err)
	}
	if err := pg.CreateRequest(ctx, order(stands[1].ID, "main")); err != nil {
		t.Fatalf("copy on another stand with the same cluster name: %v", err)
	}
	if err := pg.CreateRequest(ctx, order(stands[0].ID, "other")); !errors.Is(err, models.ErrConflict) {
		t.Fatalf("same name on the same stand: want ErrConflict, got %v", err)
	}
	service = "svc-" + uuid.NewString()[:8]
	if err := pg.CreateRequest(ctx, order(stands[0].ID, "main")); !errors.Is(err, models.ErrConflict) {
		t.Fatalf("same identity in one namespace of one stand: want ErrConflict, got %v", err)
	}
}
