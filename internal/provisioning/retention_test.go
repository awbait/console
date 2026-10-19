package provisioning_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"console/internal/provisioning"
	"console/pkg/models"
)

// A deleted order, a discarded draft too, goes for good with its history once
// the retention runs out. One deleted more recently, and a live one, stay. A
// retention of zero keeps everything.
func TestPurgeDeletedAfterRetention(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	mk := func(name string) *models.Request {
		r, err := s.prov.Create(ctx, member("core"), newOrder(name))
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		return r
	}
	discard := func(r *models.Request, ago time.Duration) {
		if _, err := s.prov.Delete(ctx, member("core"), r.ID); err != nil {
			t.Fatalf("discard %s: %v", r.ServiceName, err)
		}
		got, _ := s.st.GetRequest(ctx, r.ID)
		at := time.Now().Add(-ago)
		got.DeletedAt = &at
		if err := s.st.UpdateRequest(ctx, got); err != nil {
			t.Fatalf("backdate %s: %v", r.ServiceName, err)
		}
	}
	old, recent, live := mk("pg-old"), mk("pg-recent"), mk("pg-live")
	discard(old, 40*24*time.Hour)
	discard(recent, 2*24*time.Hour)

	if err := s.prov.PurgeDeleted(ctx, 0); err != nil {
		t.Fatalf("purge with no retention: %v", err)
	}
	if _, err := s.st.GetRequest(ctx, old.ID); err != nil {
		t.Fatalf("no retention keeps everything: %v", err)
	}

	if err := s.prov.PurgeDeleted(ctx, 30*24*time.Hour); err != nil {
		t.Fatalf("purge: %v", err)
	}
	if _, err := s.st.GetRequest(ctx, old.ID); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("the order deleted 40 days ago should be gone: %v", err)
	}
	if evs, _ := s.st.ListEvents(ctx, old.ID); len(evs) != 0 {
		t.Fatalf("its history should be gone too: %d events", len(evs))
	}
	for _, r := range []*models.Request{recent, live} {
		if _, err := s.st.GetRequest(ctx, r.ID); err != nil {
			t.Fatalf("%s should stay: %v", r.ServiceName, err)
		}
	}

	// The sweep looks once an hour, not on every tick of the poller.
	late := mk("pg-late")
	discard(late, 40*24*time.Hour)
	if err := s.prov.PurgeDeleted(ctx, 30*24*time.Hour); err != nil {
		t.Fatalf("second purge: %v", err)
	}
	if _, err := s.st.GetRequest(ctx, late.ID); err != nil {
		t.Fatalf("a sweep within the hour does not look again: %v", err)
	}

	// The page of a deleted order says when it goes; a live one has no date.
	gone, _ := s.st.GetRequest(ctx, recent.ID)
	at := provisioning.PurgeAt(gone, 30*24*time.Hour)
	if at == nil || !at.Equal(gone.DeletedAt.Add(30*24*time.Hour)) {
		t.Fatalf("purge date: %v", at)
	}
	still, _ := s.st.GetRequest(ctx, live.ID)
	if provisioning.PurgeAt(still, 30*24*time.Hour) != nil || provisioning.PurgeAt(gone, 0) != nil {
		t.Fatal("no purge date for a live order or with no retention")
	}
}
