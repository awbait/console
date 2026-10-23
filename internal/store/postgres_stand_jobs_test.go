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

// Stand jobs round-trip with their failures, one runs at a time per stand
// (a partial unique index), and a finished one leaves room for the next.
// Needs a scratch Postgres: set STORE_TEST_URL.
func TestPostgresStandJobs(t *testing.T) {
	url := os.Getenv("STORE_TEST_URL")
	if url == "" {
		t.Skip("set STORE_TEST_URL to run the Postgres stand jobs test")
	}
	ctx := context.Background()
	pg, err := NewPostgres(ctx, url, 5)
	if err != nil {
		t.Fatalf("NewPostgres: %v", err)
	}
	defer pg.Close()

	st := &models.Stand{ID: uuid.NewString(), Name: "job-" + uuid.NewString()[:8], DefaultCluster: "in-cluster", GitPath: "managed-services/job"}
	if err := pg.CreateStand(ctx, st); err != nil {
		t.Fatalf("create stand: %v", err)
	}
	defer func() { _, _ = pg.pool.Exec(ctx, `DELETE FROM stands WHERE id = $1`, st.ID) }()

	j := &models.StandJob{ID: uuid.NewString(), StandID: st.ID, Kind: models.StandJobModeChange,
		FromMode: models.ModeConsole, ToMode: models.ModeGit, Status: models.StandJobRunning, CreatedBy: "adm"}
	if err := pg.CreateStandJob(ctx, j); err != nil {
		t.Fatalf("create job: %v", err)
	}
	second := *j
	second.ID = uuid.NewString()
	if err := pg.CreateStandJob(ctx, &second); !errors.Is(err, models.ErrConflict) {
		t.Fatalf("a second running job: want ErrConflict, got %v", err)
	}
	if err := pg.CreateStandJob(ctx, &models.StandJob{ID: uuid.NewString(), StandID: uuid.NewString(), Kind: "x", Status: models.StandJobRunning}); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("a job on no stand: want ErrNotFound, got %v", err)
	}

	now := time.Now().Truncate(time.Microsecond)
	j.Total, j.Done, j.Waiting, j.Skipped = 3, 1, 1, 1
	j.Failures = []models.StandJobFailure{{OrderID: "o1", ServiceName: "pg1", Reason: "mr_closed"}}
	j.Handled = map[string]string{"o2": models.StandJobUpdated, "o3": models.StandJobSkipped}
	j.Status, j.FinishedAt = models.StandJobDone, &now
	if err := pg.UpdateStandJob(ctx, j); err != nil {
		t.Fatalf("update: %v", err)
	}
	got, err := pg.GetStandJob(ctx, j.ID)
	if err != nil || got.Total != 3 || got.Done != 1 || got.Skipped != 1 || len(got.Failures) != 1 || got.Failures[0].ServiceName != "pg1" || !got.FinishedAt.Equal(now) {
		t.Fatalf("round-trip: %+v %v", got, err)
	}
	if got.Handled["o2"] != models.StandJobUpdated || got.Handled["o3"] != models.StandJobSkipped {
		t.Fatalf("what the job handled is kept: %+v", got.Handled)
	}
	if err := pg.CreateStandJob(ctx, &second); err != nil {
		t.Fatalf("a new job once the first is done: %v", err)
	}
	list, err := pg.ListStandJobs(ctx, st.ID)
	if err != nil || len(list) != 2 || list[0].ID != second.ID {
		t.Fatalf("newest first: %+v %v", list, err)
	}
	running, err := pg.ListRunningStandJobs(ctx)
	if err != nil {
		t.Fatalf("running: %v", err)
	}
	found := false
	for _, r := range running {
		found = found || r.ID == second.ID
		if r.ID == j.ID {
			t.Fatal("a finished job is not running")
		}
	}
	if !found {
		t.Fatalf("the new job is running: %+v", running)
	}
}
