package store

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
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

// The audience floor, in SQL. The in-memory store agrees with this by hand
// (internal/notify); what only Postgres can answer is whether the predicate
// itself is right, since it is what every read of every bell goes through.
//
// Requires the same scratch Postgres as TestPostgresNotifications.
func TestPostgresAudienceFloor(t *testing.T) {
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
	if _, err := pg.pool.Exec(ctx, `TRUNCATE notifications, notification_reads, notification_cursor, user_audiences`); err != nil {
		t.Fatalf("truncate: %v", err)
	}

	n := 0
	add := func(audience models.NotificationAudience, key string) {
		t.Helper()
		n++
		err := pg.AddNotification(ctx, &models.Notification{
			ID: uuid.NewString(), Kind: "k", SubjectType: models.SubjectOrder, SubjectID: "o1",
			Audience: audience, AudienceKey: key, Level: models.LevelInfo,
		})
		if err != nil {
			t.Fatalf("add %d: %v", n, err)
		}
	}
	count := func(f NotificationFilter) int {
		t.Helper()
		got, err := pg.CountUnread(ctx, f)
		if err != nil {
			t.Fatalf("count unread: %v", err)
		}
		return got
	}
	record := func(subject, role string, teams ...string) {
		t.Helper()
		if err := pg.RecordAudiences(ctx, subject, teams, role, time.Time{}); err != nil {
			t.Fatalf("record audiences: %v", err)
		}
	}

	// Everything below happened before anybody in this test turned up.
	add(models.AudienceAll, "")
	add(models.AudienceRole, "admin")
	add(models.AudienceTeam, "core")
	add(models.AudienceUser, "alice")

	// A reader the portal has never recorded is not treated as new.
	unknown := NotificationFilter{Subject: "alice", Teams: []string{"core"}, Role: "admin"}
	if got := count(unknown); got != 4 {
		t.Fatalf("an unrecorded reader = %d, want all 4", got)
	}

	// Recorded now: the past is not theirs, except what names them.
	record("alice", "admin", "core")
	if got := count(unknown); got != 1 {
		t.Fatalf("after the floor = %d, want only the one addressed to alice", got)
	}

	// News from after the floor arrives as usual.
	add(models.AudienceAll, "")
	add(models.AudienceRole, "admin")
	add(models.AudienceTeam, "core")
	if got := count(unknown); got != 4 {
		t.Fatalf("after three more = %d, want 4", got)
	}

	// Being seen again does not move the floor over what is already unread.
	record("alice", "admin", "core")
	if got := count(unknown); got != 4 {
		t.Fatalf("a later appearance took %d away", 4-count(unknown))
	}

	// The floor is per audience: the same person joining a team later starts
	// empty there and keeps what they already had elsewhere.
	add(models.AudienceTeam, "payments")
	record("alice", "admin", "core", "payments")
	joined := NotificationFilter{Subject: "alice", Teams: []string{"core", "payments"}, Role: "admin"}
	if got := count(joined); got != 4 {
		t.Fatalf("a new team = %d, want the 4 they already had and nothing of its backlog", got)
	}
	add(models.AudienceTeam, "payments")
	if got := count(joined); got != 5 {
		t.Fatalf("news of the new team = %d, want 5", got)
	}

	// And the list agrees with the count.
	list, err := pg.ListNotifications(ctx, joined)
	if err != nil || len(list) != 5 {
		t.Fatalf("list = %d rows, %v; want 5", len(list), err)
	}
}
