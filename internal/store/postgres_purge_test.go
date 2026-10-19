package store

import (
	"context"
	"os"
	"testing"
	"time"

	"console/pkg/models"
	"github.com/google/uuid"
)

// An order deleted before the cutoff goes for good, with its merge requests and
// history, in one statement the foreign keys accept. One deleted after it, and
// a live one, stay. Needs a scratch Postgres: set STORE_TEST_URL.
func TestPostgresPurgeDeletedRequests(t *testing.T) {
	url := os.Getenv("STORE_TEST_URL")
	if url == "" {
		t.Skip("set STORE_TEST_URL to run the Postgres purge test")
	}
	ctx := context.Background()
	pg, err := NewPostgres(ctx, url, 5)
	if err != nil {
		t.Fatalf("NewPostgres: %v", err)
	}
	defer pg.Close()

	st := &models.Stand{ID: uuid.NewString(), Name: "purge-" + uuid.NewString()[:8], DefaultCluster: "in-cluster"}
	if err := pg.CreateStand(ctx, st); err != nil {
		t.Fatalf("create stand: %v", err)
	}
	var ids []string
	defer func() {
		for _, id := range ids {
			_, _ = pg.pool.Exec(ctx, `DELETE FROM request_mrs WHERE request_id=$1`, id)
			_, _ = pg.pool.Exec(ctx, `DELETE FROM request_events WHERE request_id=$1`, id)
			_, _ = pg.pool.Exec(ctx, `DELETE FROM requests WHERE id=$1`, id)
		}
		_, _ = pg.pool.Exec(ctx, `DELETE FROM stands WHERE id=$1`, st.ID)
	}()
	// deletedAt nil leaves the order live. The dates are far back so the purge
	// below cannot reach anybody else's rows in a shared database.
	order := func(deletedAt *time.Time) *models.Request {
		r := &models.Request{
			ID: uuid.NewString(), CreatedBy: "u", CreatedByName: "U", Team: "core",
			ChartProject: "platform", ChartName: "postgres", ChartVersion: "1",
			ServiceName: "svc-" + uuid.NewString()[:8], StandID: st.ID, Cluster: "in-cluster",
			Namespace: "db", ValuesYAML: "{}", Status: models.StatusDraft,
		}
		ids = append(ids, r.ID)
		if err := pg.CreateRequest(ctx, r); err != nil {
			t.Fatalf("create: %v", err)
		}
		if err := pg.AddEvent(ctx, &models.RequestEvent{RequestID: r.ID, Actor: "u", EventType: "draft_created"}); err != nil {
			t.Fatalf("event: %v", err)
		}
		if err := pg.AddMR(ctx, &models.RequestMR{ID: uuid.NewString(), RequestID: r.ID, MRIID: 1,
			Status: models.MROpened, Action: models.ActionCreate}); err != nil {
			t.Fatalf("mr: %v", err)
		}
		if deletedAt != nil {
			if _, err := pg.pool.Exec(ctx, `UPDATE requests SET status='DELETED', deleted_at=$2 WHERE id=$1`,
				r.ID, *deletedAt); err != nil {
				t.Fatalf("mark deleted: %v", err)
			}
		}
		return r
	}
	long := time.Date(1990, 1, 1, 0, 0, 0, 0, time.UTC)
	later := time.Date(1990, 6, 1, 0, 0, 0, 0, time.UTC)
	old, recent, live := order(&long), order(&later), order(nil)

	n, err := pg.PurgeDeletedRequests(ctx, time.Date(1990, 3, 1, 0, 0, 0, 0, time.UTC), 10)
	if err != nil || n != 1 {
		t.Fatalf("purge: %d, %v", n, err)
	}
	if _, err := pg.GetRequest(ctx, old.ID); err == nil {
		t.Fatal("the order deleted before the cutoff is still there")
	}
	var left int
	_ = pg.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM request_mrs WHERE request_id=$1)
		+ (SELECT count(*) FROM request_events WHERE request_id=$1)`, old.ID).Scan(&left)
	if left != 0 {
		t.Fatalf("its merge requests and history stayed: %d rows", left)
	}
	for _, r := range []*models.Request{recent, live} {
		if _, err := pg.GetRequest(ctx, r.ID); err != nil {
			t.Fatalf("order %s should stay: %v", r.ID, err)
		}
	}
}
