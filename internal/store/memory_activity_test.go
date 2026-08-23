package store

import (
	"context"
	"testing"
	"time"

	"console/pkg/models"
)

// The activity feed is about people. Everything the platform does on its own -
// the reconcile loop advancing an order, auto-discovery registering a chart -
// belongs in the order's timeline and would drown a page whose whole question
// is "who is doing what".
func TestListActivitySkipsThePlatformsOwnEvents(t *testing.T) {
	ctx := context.Background()
	m := NewMemory()
	r := &models.Request{ID: "11111111-1111-1111-1111-111111111111", Team: "core",
		ChartName: "gateway", ServiceName: "edge", Status: models.StatusDraft}
	if err := m.CreateRequest(ctx, r); err != nil {
		t.Fatalf("create request: %v", err)
	}
	add := func(actor, name, typ string) {
		t.Helper()
		if err := m.AddEvent(ctx, &models.RequestEvent{
			RequestID: r.ID, Actor: actor, ActorName: name, EventType: typ,
		}); err != nil {
			t.Fatalf("add event: %v", err)
		}
	}
	add("u1", "Ada", "created")
	add(models.ActorSystem, "", "status_changed")
	add("u1", "Ada", "submitted")

	feed, err := m.ListActivity(ctx, 0)
	if err != nil {
		t.Fatalf("list activity: %v", err)
	}
	if len(feed) != 2 {
		t.Fatalf("want the two human events, got %d: %+v", len(feed), feed)
	}
	// Newest first.
	if feed[0].EventType != "submitted" || feed[1].EventType != "created" {
		t.Fatalf("order: %s then %s", feed[0].EventType, feed[1].EventType)
	}
	if feed[0].Team != "core" || feed[0].Title != "edge" || feed[0].ActorName != "Ada" {
		t.Fatalf("event lost its context: %+v", feed[0])
	}
	if feed[0].Source != models.ActivityOrder {
		t.Fatalf("source: %s", feed[0].Source)
	}
}

// The feed is a ribbon, not a journal: a caller that asks for everything gets a
// bounded answer.
func TestListActivityLimits(t *testing.T) {
	ctx := context.Background()
	m := NewMemory()
	r := &models.Request{ID: "22222222-2222-2222-2222-222222222222", Team: "core",
		ChartName: "gateway", ServiceName: "edge", Status: models.StatusDraft}
	_ = m.CreateRequest(ctx, r)
	for range 5 {
		_ = m.AddEvent(ctx, &models.RequestEvent{RequestID: r.ID, Actor: "u1", EventType: "updated"})
	}
	feed, _ := m.ListActivity(ctx, 2)
	if len(feed) != 2 {
		t.Fatalf("limit ignored: %d rows", len(feed))
	}
	feed, _ = m.ListActivity(ctx, maxActivityLimit+1000)
	if len(feed) != 5 {
		t.Fatalf("an absurd limit should be clamped, not refused: %d rows", len(feed))
	}
}

// The gauges count the same stream the page shows, grouped, and only inside the
// window they are labelled with.
func TestCountActivityGroupsAndWindows(t *testing.T) {
	ctx := context.Background()
	m := NewMemory()
	now := time.Now()
	m.now = func() time.Time { return now }

	mk := func(id, team, name string) *models.Request {
		r := &models.Request{ID: id, Team: team, ChartName: "gateway", ServiceName: name,
			Status: models.StatusDraft}
		if err := m.CreateRequest(ctx, r); err != nil {
			t.Fatalf("create %s: %v", id, err)
		}
		return r
	}
	core := mk("33333333-3333-3333-3333-333333333333", "core", "edge")
	data := mk("44444444-4444-4444-4444-444444444444", "data", "lake")

	old := now.Add(-48 * time.Hour)
	_ = m.AddEvent(ctx, &models.RequestEvent{RequestID: core.ID, Actor: "u1", EventType: "created", CreatedAt: old})
	_ = m.AddEvent(ctx, &models.RequestEvent{RequestID: core.ID, Actor: "u1", EventType: "updated"})
	_ = m.AddEvent(ctx, &models.RequestEvent{RequestID: core.ID, Actor: "u2", EventType: "updated"})
	_ = m.AddEvent(ctx, &models.RequestEvent{RequestID: data.ID, Actor: "u3", EventType: "updated"})

	counts, err := m.CountActivity(ctx, now.Add(-24*time.Hour))
	if err != nil {
		t.Fatalf("count activity: %v", err)
	}
	got := map[string]int{}
	for _, c := range counts {
		got[c.EventType+"/"+c.Team] = c.Count
	}
	want := map[string]int{"updated/core": 2, "updated/data": 1}
	if len(got) != len(want) {
		t.Fatalf("groups: got %v want %v", got, want)
	}
	for k, v := range want {
		if got[k] != v {
			t.Fatalf("%s: got %d want %d (all: %v)", k, got[k], v, got)
		}
	}
}
