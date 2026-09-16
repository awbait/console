package provisioning_test

import (
	"context"
	"strings"
	"testing"

	"console/internal/provisioning"
	"console/internal/store"
	"console/pkg/models"
)

// An order can end up holding a merge request it never recorded: the change
// reaches GitLab and the status change meant to follow it does not (the two are
// separate writes, and the second can fail on its own). Left alone such an order
// is blocked for good - every further change is refused because a request is
// open, while nothing tends a request the order does not know about.
//
// Reconcile has to put the order back on the status the open request implies.
func TestReconcileRecoversOrderWithUnrecordedChange(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")

	req, err := s.prov.Create(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "pg1", Values: validValues(),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	s.mergeLatestMR(ctx, t, req.ID)
	s.tick(ctx)
	s.tick(ctx)
	if got := mustStatus(ctx, t, s.st, req.ID); got != models.StatusHealthy {
		t.Fatalf("want HEALTHY before the edit, got %s", got)
	}

	// Open a change the ordinary way, then take the order back to where it was.
	// That is exactly what openChange leaves behind when the transition after it
	// fails: the merge request exists and is recorded, the order does not know.
	if _, err := s.prov.Update(ctx, u, req.ID, provisioning.UpdateInput{
		Values: map[string]any{"auth": map[string]any{"database": "app2"}},
	}); err != nil {
		t.Fatalf("update: %v", err)
	}
	stuck, err := s.st.GetRequest(ctx, req.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	stuck.Status = models.StatusHealthy
	if err := s.st.UpdateRequest(ctx, stuck); err != nil {
		t.Fatalf("rewind: %v", err)
	}

	// Before the fix this is where the order stayed for good.
	if _, err := s.prov.Update(ctx, u, req.ID, provisioning.UpdateInput{Values: validValues()}); err == nil {
		t.Fatal("a second change was accepted while a merge request is open")
	}

	s.tick(ctx)

	if got := mustStatus(ctx, t, s.st, req.ID); got != models.StatusMRCreated {
		t.Fatalf("order not recovered: want MR_CREATED, got %s", got)
	}

	// And the recovery is in the trail, because an order that moved on its own is
	// the first thing somebody looks for afterwards.
	events, err := s.st.ListEvents(ctx, req.ID)
	if err != nil {
		t.Fatalf("events: %v", err)
	}
	var found bool
	for _, e := range events {
		if e.EventType == "change_recovered" {
			found = true
		}
	}
	if !found {
		t.Error("no change_recovered event in the order's trail")
	}

	// From here the ordinary machinery carries the change through.
	s.mergeLatestMR(ctx, t, req.ID)
	s.tick(ctx)
	if got := mustStatus(ctx, t, s.st, req.ID); got == models.StatusHealthy || got == models.StatusMRCreated {
		t.Fatalf("recovered order did not move on after the merge: %s", got)
	}
}

// The ordinary case must not be touched: an order already on the status its open
// merge request implies is left exactly where it is, with nothing written to its
// trail.
func TestReconcileLeavesARecordedChangeAlone(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")

	req, err := s.prov.Create(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "pg2", Values: validValues(),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	before, err := s.st.ListEvents(ctx, req.ID)
	if err != nil {
		t.Fatalf("events: %v", err)
	}

	s.tick(ctx)

	if got := mustStatus(ctx, t, s.st, req.ID); got != models.StatusMRCreated {
		t.Fatalf("want MR_CREATED, got %s", got)
	}
	after, err := s.st.ListEvents(ctx, req.ID)
	if err != nil {
		t.Fatalf("events: %v", err)
	}
	if len(after) != len(before) {
		t.Errorf("reconcile wrote %d event(s) for an order that needed nothing", len(after)-len(before))
	}
}

// staleOnce writes to the order once, from the side, just before the portal
// commits a status change. That is the poller finishing a health check between
// the order being read and the change being recorded: the write the portal is
// about to make is now against a version that no longer exists.
type staleOnce struct {
	store.Store
	id    string
	fired bool
}

func (s *staleOnce) Tx(ctx context.Context, fn func(store.Store) error) error {
	if s.id != "" && !s.fired {
		s.fired = true
		if r, err := s.GetRequest(ctx, s.id); err == nil {
			_ = s.UpdateRequest(ctx, r)
		}
	}
	// Through the embedded store on purpose: Tx is the method being overridden.
	return s.Store.Tx(ctx, fn)
}

// The change is already in GitLab by the time its status is recorded, so losing
// that write costs an order that will not admit to its own change. One retry off
// the current row is enough, and the edit goes through as the person expects
// instead of leaving them a blocked service and us a recovery an hour later.
func TestChangeIsRecordedDespiteAConcurrentWrite(t *testing.T) {
	ctx := context.Background()
	st := &staleOnce{Store: store.NewMemory()}
	s := newStackOn(t, st)
	u := member("core")

	req, err := s.prov.Create(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "pg3", Values: validValues(),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	s.mergeLatestMR(ctx, t, req.ID)
	s.tick(ctx)
	s.tick(ctx)

	// From here the next status write loses its race.
	st.id = req.ID

	if _, err := s.prov.Update(ctx, u, req.ID, provisioning.UpdateInput{
		Values: map[string]any{"auth": map[string]any{"database": "app2"}},
	}); err != nil {
		t.Fatalf("edit refused after a concurrent write: %v", err)
	}
	if !st.fired {
		t.Fatal("the concurrent write never happened, so nothing was proven")
	}
	if got := mustStatus(ctx, t, s.st, req.ID); got != models.StatusMRCreated {
		t.Fatalf("change not recorded: want MR_CREATED, got %s", got)
	}

	// And the order is left holding the values the edit was about, not the ones
	// the write that won happened to carry.
	saved, err := s.st.GetRequest(ctx, req.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if !strings.Contains(saved.ValuesYAML, "app2") {
		t.Errorf("edited values were lost: %s", saved.ValuesYAML)
	}
}
