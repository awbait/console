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

// Stored stand checks round-trip with their facts, replace the previous set
// as a whole, and carry the Argo CD flag onto the stand. Needs a scratch
// Postgres: set STORE_TEST_URL.
func TestPostgresStandChecks(t *testing.T) {
	url := os.Getenv("STORE_TEST_URL")
	if url == "" {
		t.Skip("set STORE_TEST_URL to run the Postgres stand checks test")
	}
	ctx := context.Background()
	pg, err := NewPostgres(ctx, url, 5)
	if err != nil {
		t.Fatalf("NewPostgres: %v", err)
	}
	defer pg.Close()

	st := &models.Stand{ID: uuid.NewString(), Name: "chk-" + uuid.NewString()[:8], DefaultCluster: "in-cluster", GitPath: "managed-services/chk"}
	if err := pg.CreateStand(ctx, st); err != nil {
		t.Fatalf("create: %v", err)
	}
	defer func() { _, _ = pg.pool.Exec(ctx, `DELETE FROM stands WHERE id = $1`, st.ID) }()
	if !st.ArgoConnected || st.CheckedAt != nil {
		t.Fatalf("a new stand is wired until a check says otherwise: %+v", st)
	}

	now := time.Now().Truncate(time.Microsecond)
	no := false
	rows := []*models.StandCheck{
		{ID: "stand_git", Component: "gitlab", Verdict: "ok", Reason: "role_enough", Facts: map[string]string{"path": "managed-services/chk"}, CheckedAt: now},
		{ID: "stand_argo_app", Component: "argocd", Verdict: "fail", Reason: "apps_missing", CheckedAt: now},
	}
	if err := pg.SaveStandChecks(ctx, st.ID, rows, &no); err != nil {
		t.Fatalf("save: %v", err)
	}
	got, err := pg.ListStandChecks(ctx, st.ID)
	if err != nil || len(got) != 2 {
		t.Fatalf("list: %d %v", len(got), err)
	}
	if got[1].ID != "stand_git" || got[1].Facts["path"] != "managed-services/chk" || !got[1].CheckedAt.Equal(now) {
		t.Fatalf("stored row: %+v", got[1])
	}
	again, _ := pg.GetStand(ctx, st.ID)
	if again.ArgoConnected || again.CheckedAt == nil || !again.CheckedAt.Equal(now) {
		t.Fatalf("the flag and the time landed on the stand: %+v", again)
	}

	// The next round replaces the set, and a nil flag leaves the stand's.
	later := now.Add(time.Minute)
	if err := pg.SaveStandChecks(ctx, st.ID, []*models.StandCheck{
		{ID: "stand_git", Component: "gitlab", Verdict: "warn", CheckedAt: later},
	}, nil); err != nil {
		t.Fatalf("save again: %v", err)
	}
	got, _ = pg.ListStandChecks(ctx, st.ID)
	if len(got) != 1 || got[0].Verdict != "warn" || len(got[0].Facts) != 0 {
		t.Fatalf("replaced set: %+v", got)
	}
	again, _ = pg.GetStand(ctx, st.ID)
	if again.ArgoConnected || !again.CheckedAt.Equal(later) {
		t.Fatalf("nil keeps the flag, the time moves: %+v", again)
	}
	all, err := pg.ListAllStandChecks(ctx)
	if err != nil || len(all) == 0 {
		t.Fatalf("all: %d %v", len(all), err)
	}
	if err := pg.SaveStandChecks(ctx, uuid.NewString(), rows, nil); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("unknown stand: want ErrNotFound, got %v", err)
	}
}
