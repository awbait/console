package notify_test

import (
	"context"
	"testing"
	"time"

	"console/internal/notify"
	"console/internal/store"
	"console/pkg/models"
)

// arrived records that the portal has seen this reader now, the way it does on
// every request they make (store.RecordAudiences), and returns them as a reader
// of the feed.
func arrived(t *testing.T, st store.Store, subject, role string, teams ...string) store.NotificationFilter {
	t.Helper()
	if err := st.RecordAudiences(context.Background(), subject, teams, role, time.Time{}); err != nil {
		t.Fatalf("record audiences: %v", err)
	}
	return reader(subject, role, teams...)
}

// The bug this is about: an audience is a rule, so somebody who signs in for the
// first time matches "everyone" - and every announcement the portal has ever
// made is unread for them. A bell full of news from before they existed.
func TestFirstSignInInheritsNothing(t *testing.T) {
	ctx := context.Background()
	st := store.NewMemory()
	svc := notify.New(st, nil, nil)

	for range 3 {
		svc.Send(ctx, nil, notify.Notification{Kind: "portal_updated", Audience: models.AudienceAll})
	}
	newcomer := arrived(t, st, "newbie", "member")

	if got := unread(t, st, newcomer); got != 0 {
		t.Fatalf("a first sign-in must open on an empty bell, got %d unread", got)
	}
	if list, err := st.ListNotifications(ctx, newcomer); err != nil || len(list) != 0 {
		t.Fatalf("feed = %d rows, %v; want nothing from before they were here", len(list), err)
	}

	// What happens afterwards is theirs like anybody's.
	svc.Send(ctx, nil, notify.Notification{Kind: "portal_updated", Audience: models.AudienceAll})
	if got := unread(t, st, newcomer); got != 1 {
		t.Fatalf("want the announcement made since, got %d", got)
	}
}

// Being given a role or joining a team is the same story: the backlog belongs to
// whoever held it then.
func TestANewAudienceStartsEmpty(t *testing.T) {
	ctx := context.Background()
	st := store.NewMemory()
	svc := notify.New(st, nil, nil)

	arrived(t, st, "alice", "member", "core")
	svc.Send(ctx, nil, notify.Notification{Kind: "version_submitted", Audience: models.AudienceRole, AudienceKey: "admin"})
	svc.Send(ctx, nil, notify.Notification{Kind: "order_degraded", Audience: models.AudienceTeam, AudienceKey: "payments"})

	// The same person comes back an admin, and in a team they were not in.
	promoted := arrived(t, st, "alice", "admin", "core", "payments")
	if got := unread(t, st, promoted); got != 0 {
		t.Fatalf("a new role and a new team must start empty, got %d unread", got)
	}

	svc.Send(ctx, nil, notify.Notification{Kind: "version_submitted", Audience: models.AudienceRole, AudienceKey: "admin"})
	svc.Send(ctx, nil, notify.Notification{Kind: "order_degraded", Audience: models.AudienceTeam, AudienceKey: "payments"})
	if got := unread(t, st, promoted); got != 2 {
		t.Fatalf("want both pieces of news since the change, got %d", got)
	}
}

// The floor is where somebody came in, not where they last were: an appearance
// after the news must not swallow it.
func TestBeingSeenAgainKeepsWhatIsUnread(t *testing.T) {
	ctx := context.Background()
	st := store.NewMemory()
	svc := notify.New(st, nil, nil)

	alice := arrived(t, st, "alice", "member", "core")
	svc.Send(ctx, nil, notify.Notification{Kind: "order_degraded", Audience: models.AudienceTeam, AudienceKey: "core"})
	svc.Send(ctx, nil, notify.Notification{Kind: "portal_updated", Audience: models.AudienceAll})

	arrived(t, st, "alice", "member", "core") // the next request, and the next day
	if got := unread(t, st, alice); got != 2 {
		t.Fatalf("want both still unread, got %d", got)
	}
}

// A notification addressed to one person names them, so it cannot be older than
// they are: the floor never applies to it.
func TestPersonalNewsIsNeverTooOld(t *testing.T) {
	ctx := context.Background()
	st := store.NewMemory()
	svc := notify.New(st, nil, nil)

	svc.Send(ctx, nil, notify.Notification{Kind: "order_degraded", Audience: models.AudienceUser, AudienceKey: "alice"})
	alice := arrived(t, st, "alice", "member", "core")

	if got := unread(t, st, alice); got != 1 {
		t.Fatalf("want the notification addressed to alice, got %d", got)
	}
}

// A reader the portal has never recorded keeps everything: nothing is hidden
// from somebody it cannot say is new.
func TestAnUnrecordedReaderLosesNothing(t *testing.T) {
	ctx := context.Background()
	st := store.NewMemory()
	svc := notify.New(st, nil, nil)

	svc.Send(ctx, nil, notify.Notification{Kind: "portal_updated", Audience: models.AudienceAll})
	if got := unread(t, st, reader("ghost", "member")); got != 1 {
		t.Fatalf("want the announcement, got %d", got)
	}
}
