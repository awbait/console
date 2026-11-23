package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"console/pkg/models"
)

func TestMemorySetDefaultStandRejectsDeleted(t *testing.T) {
	ctx := context.Background()
	m := NewMemory()
	a := &models.Stand{ID: "stand-a", Name: "a", DefaultCluster: "a", Default: true}
	b := &models.Stand{ID: "stand-b", Name: "b", DefaultCluster: "b"}
	if err := m.CreateStand(ctx, a); err != nil {
		t.Fatal(err)
	}
	if err := m.CreateStand(ctx, b); err != nil {
		t.Fatal(err)
	}
	if err := m.DeleteStand(ctx, b.ID); err != nil {
		t.Fatal(err)
	}
	if err := m.SetDefaultStand(ctx, b.ID); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("SetDefaultStand on deleted stand: want ErrNotFound, got %v", err)
	}
	def, err := m.DefaultStand(ctx)
	if err != nil || def.ID != a.ID {
		t.Fatalf("default stand corrupted: %+v %v", def, err)
	}
}

func TestMemoryUpdateStandJobRefusesStopped(t *testing.T) {
	ctx := context.Background()
	m := NewMemory()
	st := &models.Stand{ID: "stand-a", Name: "a", DefaultCluster: "a"}
	if err := m.CreateStand(ctx, st); err != nil {
		t.Fatal(err)
	}
	job := &models.StandJob{ID: "job-1", StandID: st.ID, Kind: models.StandJobDelete, Status: models.StandJobRunning}
	if err := m.CreateStandJob(ctx, job); err != nil {
		t.Fatal(err)
	}

	// Admin stops the job.
	now := time.Now()
	stopped := *job
	stopped.Status = models.StandJobStopped
	stopped.FinishedAt = &now
	if err := m.UpdateStandJob(ctx, &stopped); err != nil {
		t.Fatalf("stop job: %v", err)
	}

	// An in-flight poller pass trying to save running/done state must get ErrConflict
	// and never resurrect the stopped job.
	stale := *job
	stale.Status = models.StandJobRunning
	stale.Done = 1
	if err := m.UpdateStandJob(ctx, &stale); !errors.Is(err, models.ErrConflict) {
		t.Fatalf("resurrect stopped job: want ErrConflict, got %v", err)
	}
	got, err := m.GetStandJob(ctx, job.ID)
	if err != nil || got.Status != models.StandJobStopped {
		t.Fatalf("job status after stale write: %+v %v", got, err)
	}
}
