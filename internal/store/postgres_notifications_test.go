package store

import (
	"context"
	"os"
	"testing"

	"console/pkg/models"
)

// The in-memory store cannot catch what Postgres refuses. This one is about the
// SQL itself: an insert whose ON CONFLICT does not match the partial unique
// index fails for every notification, keyed or not, and the failure is only
// logged - so the portal looks like it works and tells nobody anything.
//
// Requires a scratch Postgres: set STORE_TEST_URL, e.g.
//
//	STORE_TEST_URL=postgres://portal:portal@localhost:5432/store_notify_test?sslmode=disable
func TestPostgresNotifications(t *testing.T) {
	url := os.Getenv("STORE_TEST_URL")
	if url == "" {
		t.Skip("set STORE_TEST_URL to run the Postgres notification store test")
	}
	ctx := context.Background()
	pg, err := NewPostgres(ctx, url, 5)
	if err != nil {
		t.Fatalf("NewPostgres: %v", err)
	}
	defer pg.Close()
	if _, err := pg.pool.Exec(ctx, `TRUNCATE notifications, notification_reads, notification_cursor`); err != nil {
		t.Fatalf("truncate: %v", err)
	}

	me := NotificationFilter{Subject: "alice", Teams: []string{"core"}, Role: "member"}
	add := func(id, kind, dedup string, audience models.NotificationAudience, key string) {
		t.Helper()
		n := &models.Notification{
			ID: id, Kind: kind, SubjectType: models.SubjectOrder, SubjectID: "o1",
			Audience: audience, AudienceKey: key, Level: models.LevelInfo, DedupKey: dedup,
			Payload: map[string]any{"service_name": "payments"},
		}
		if err := pg.AddNotification(ctx, n); err != nil {
			t.Fatalf("add %s: %v", kind, err)
		}
	}

	// A notification without a key is never a duplicate: two of them are two.
	add("11111111-1111-1111-1111-111111111111", "version_rejected", "", models.AudienceTeam, "core")
	add("22222222-2222-2222-2222-222222222222", "version_rejected", "", models.AudienceTeam, "core")
	// One with a key is said once, however often the loop comes round.
	add("33333333-3333-3333-3333-333333333333", "order_degraded", "order:1:degraded", models.AudienceUser, "alice")
	add("44444444-4444-4444-4444-444444444444", "order_degraded", "order:1:degraded", models.AudienceUser, "alice")

	if got, err := pg.CountUnread(ctx, me); err != nil || got != 3 {
		t.Fatalf("unread = %d, %v; want 3", got, err)
	}

	list, err := pg.ListNotifications(ctx, me)
	if err != nil || len(list) != 3 {
		t.Fatalf("list = %d rows, %v; want 3", len(list), err)
	}
	if list[0].Payload["service_name"] != "payments" {
		t.Fatalf("payload did not survive the round trip: %+v", list[0].Payload)
	}

	// Read is personal, and a cursor covers what was already there.
	if err := pg.MarkRead(ctx, list[0].ID, "alice"); err != nil {
		t.Fatalf("mark read: %v", err)
	}
	if got, _ := pg.CountUnread(ctx, me); got != 2 {
		t.Fatalf("after one read: unread = %d, want 2", got)
	}
	other := NotificationFilter{Subject: "bob", Teams: []string{"core"}, Role: "member"}
	if got, _ := pg.CountUnread(ctx, other); got != 2 {
		t.Fatalf("bob sees the team's two, got %d", got)
	}
	if err := pg.MarkAllRead(ctx, "alice"); err != nil {
		t.Fatalf("mark all read: %v", err)
	}
	if got, _ := pg.CountUnread(ctx, me); got != 0 {
		t.Fatalf("after read-all: unread = %d, want 0", got)
	}

	// Someone in another team is addressed by none of this.
	stranger := NotificationFilter{Subject: "eve", Teams: []string{"payments"}, Role: "member"}
	if got, _ := pg.CountUnread(ctx, stranger); got != 0 {
		t.Fatalf("stranger sees %d, want 0", got)
	}
}
