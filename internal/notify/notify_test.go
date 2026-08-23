package notify_test

import (
	"context"
	"testing"
	"time"

	"console/internal/notify"
	"console/internal/store"
	"console/pkg/models"
)

func reader(subject, role string, teams ...string) store.NotificationFilter {
	return store.NotificationFilter{Subject: subject, Role: role, Teams: teams}
}

func unread(t *testing.T, st store.Store, f store.NotificationFilter) int {
	t.Helper()
	n, err := st.CountUnread(context.Background(), f)
	if err != nil {
		t.Fatalf("count unread: %v", err)
	}
	return n
}

// Who a notification reaches is a rule evaluated when somebody reads, not a list
// drawn up when it was written: the portal has no user directory, and teams
// change under it.
func TestAudienceDecidesWhoSeesIt(t *testing.T) {
	ctx := context.Background()
	st := store.NewMemory()
	svc := notify.New(st, nil, nil)

	svc.Send(ctx, nil, notify.Notification{Kind: "k1", Audience: models.AudienceUser, AudienceKey: "alice"})
	svc.Send(ctx, nil, notify.Notification{Kind: "k2", Audience: models.AudienceTeam, AudienceKey: "core"})
	svc.Send(ctx, nil, notify.Notification{Kind: "k3", Audience: models.AudienceRole, AudienceKey: "admin"})
	svc.Send(ctx, nil, notify.Notification{Kind: "k4", Audience: models.AudienceAll})

	cases := []struct {
		name string
		who  store.NotificationFilter
		want int
	}{
		{"the person addressed sees theirs, their team's and the announcement", reader("alice", "member", "core"), 3},
		{"a member of another team sees only the announcement", reader("bob", "member", "payments"), 1},
		{"an admin sees the role's and the announcement", reader("padmin", "admin"), 2},
		{"the auditor is addressed by nothing but announcements", reader("aud", "auditor"), 1},
	}
	for _, c := range cases {
		if got := unread(t, st, c.who); got != c.want {
			t.Fatalf("%s: want %d, got %d", c.name, c.want, got)
		}
	}
}

// The background loop revisits the same order every few seconds. Only the first
// pass is news.
func TestDedupKeySaysItOnce(t *testing.T) {
	ctx := context.Background()
	st := store.NewMemory()
	svc := notify.New(st, nil, nil)
	me := reader("alice", "member")

	for range 5 {
		svc.Send(ctx, nil, notify.Notification{
			Kind: models.NotifyOrderDegraded, Audience: models.AudienceUser, AudienceKey: "alice",
			DedupKey: "order:42:degraded",
		})
	}
	if got := unread(t, st, me); got != 1 {
		t.Fatalf("want 1 notification, got %d", got)
	}

	// Without a key, every call is its own piece of news.
	svc.Send(ctx, nil, notify.Notification{Kind: "k", Audience: models.AudienceUser, AudienceKey: "alice"})
	svc.Send(ctx, nil, notify.Notification{Kind: "k", Audience: models.AudienceUser, AudienceKey: "alice"})
	if got := unread(t, st, me); got != 3 {
		t.Fatalf("want 3 notifications, got %d", got)
	}
}

// Read is personal: one notification reaches a whole team, and each of them
// puts it away for themselves.
func TestReadIsPerReader(t *testing.T) {
	ctx := context.Background()
	st := store.NewMemory()
	svc := notify.New(st, nil, nil)
	alice, bob := reader("alice", "member", "core"), reader("bob", "member", "core")

	svc.Send(ctx, nil, notify.Notification{Kind: "k", Audience: models.AudienceTeam, AudienceKey: "core"})
	list, err := st.ListNotifications(ctx, alice)
	if err != nil || len(list) != 1 {
		t.Fatalf("list: %v, %d rows", err, len(list))
	}
	if err := st.MarkRead(ctx, list[0].ID, "alice"); err != nil {
		t.Fatalf("mark read: %v", err)
	}
	if got := unread(t, st, alice); got != 0 {
		t.Fatalf("alice: want 0 unread, got %d", got)
	}
	if got := unread(t, st, bob); got != 1 {
		t.Fatalf("bob should still have it, got %d", got)
	}

	// The row itself is still there for whoever reads the feed: read is a flag on
	// the reading, not a deletion.
	read, _ := st.ListNotifications(ctx, alice)
	if len(read) != 1 || !read[0].Read {
		t.Fatalf("want one row marked read, got %+v", read)
	}
}

func TestReadAllCoversWhatIsAlreadyThere(t *testing.T) {
	ctx := context.Background()
	st := store.NewMemory()
	svc := notify.New(st, nil, nil)
	me := reader("alice", "member")

	for range 3 {
		svc.Send(ctx, nil, notify.Notification{Kind: "k", Audience: models.AudienceUser, AudienceKey: "alice"})
	}
	if err := st.MarkAllRead(ctx, "alice"); err != nil {
		t.Fatalf("read all: %v", err)
	}
	if got := unread(t, st, me); got != 0 {
		t.Fatalf("want nothing unread, got %d", got)
	}

	// What arrives afterwards is unread again: the cursor is a moment, not a
	// switch that turns the bell off.
	svc.Send(ctx, nil, notify.Notification{Kind: "k", Audience: models.AudienceUser, AudienceKey: "alice"})
	if got := unread(t, st, me); got != 1 {
		t.Fatalf("want 1 unread after read-all, got %d", got)
	}
}

// Retention drops what has been read and is old. An unread notification is not
// clutter, it is a message nobody has seen yet.
func TestSweepKeepsTheUnread(t *testing.T) {
	ctx := context.Background()
	st := store.NewMemory()
	old := time.Now().Add(-100 * 24 * time.Hour)

	seen := &models.Notification{ID: "11111111-1111-1111-1111-111111111111", Kind: "k",
		Audience: models.AudienceUser, AudienceKey: "alice", CreatedAt: old}
	unseen := &models.Notification{ID: "22222222-2222-2222-2222-222222222222", Kind: "k",
		Audience: models.AudienceUser, AudienceKey: "alice", CreatedAt: old}
	for _, n := range []*models.Notification{seen, unseen} {
		if err := st.AddNotification(ctx, n); err != nil {
			t.Fatalf("add: %v", err)
		}
	}
	if err := st.MarkRead(ctx, seen.ID, "alice"); err != nil {
		t.Fatalf("mark read: %v", err)
	}

	if err := notify.New(st, nil, nil).SweepRead(ctx, 90*24*time.Hour); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	left, _ := st.ListNotifications(ctx, reader("alice", "member"))
	if len(left) != 1 || left[0].ID != unseen.ID {
		t.Fatalf("want only the unread one left, got %+v", left)
	}
}

// A build nobody was given is not a release to announce.
func TestPortalUpdatedIgnoresAnUnstampedBuild(t *testing.T) {
	ctx := context.Background()
	st := store.NewMemory()
	svc := notify.New(st, nil, nil)

	svc.PortalUpdated(ctx, "dev")
	svc.PortalUpdated(ctx, "")
	if got := unread(t, st, reader("padmin", "admin")); got != 0 {
		t.Fatalf("want silence, got %d", got)
	}

	svc.PortalUpdated(ctx, "0.5.0")
	svc.PortalUpdated(ctx, "0.5.0") // a restart is not another release
	if got := unread(t, st, reader("padmin", "admin")); got != 1 {
		t.Fatalf("want one announcement, got %d", got)
	}
}

// A release of the portal is news to whoever rolled it out, not to the person
// who came to order a database: they did not choose the version and cannot
// choose the next one.
func TestPortalUpdateGoesToAdminsOnly(t *testing.T) {
	ctx := context.Background()
	st := store.NewMemory()
	svc := notify.New(st, nil, nil)

	svc.PortalUpdated(ctx, "0.5.0")

	if got := unread(t, st, reader("padmin", "admin")); got != 1 {
		t.Fatalf("admin: want the announcement, got %d", got)
	}
	for _, role := range []string{"member", "auditor", "support", "security"} {
		if got := unread(t, st, reader("alice", role)); got != 0 {
			t.Fatalf("%s: want silence, got %d", role, got)
		}
	}
}

// A chart nobody has adopted belongs to the admin group. That group grants the
// admin role and is in nobody's team list (internal/auth/rbac.go), so a
// notification addressed to it as a team used to reach no one at all.
func TestWhatTheAdminGroupOwnsGoesToAdmins(t *testing.T) {
	ctx := context.Background()
	st := store.NewMemory()
	svc := notify.New(st, nil, nil)
	svc.SetAdminTeam("platform-admins")

	unclaimed := &models.ChartPublication{ID: "p1", ChartProject: "platform", ChartName: "waypoint",
		OwnerTeam: "platform-admins"}
	owned := &models.ChartPublication{ID: "p2", ChartProject: "platform", ChartName: "postgres",
		OwnerTeam: "core"}

	svc.VersionRejected(ctx, nil, unclaimed, "1.0.0", "Опишите поле subnet.", nil)
	svc.VersionApproved(ctx, nil, owned, "2.0.0", nil)

	admin := reader("padmin", "admin")
	if got := unread(t, st, admin); got != 1 {
		t.Fatalf("admin should hear about what their group owns, got %d", got)
	}
	core := reader("alice", "member", "core")
	if got := unread(t, st, core); got != 1 {
		t.Fatalf("the owning team hears about its own service, got %d", got)
	}

	// And neither hears the other's.
	list, _ := st.ListNotifications(ctx, admin)
	if len(list) != 1 || list[0].Kind != models.NotifyVersionRejected {
		t.Fatalf("admin feed = %+v", list)
	}
}

// A publication with no owner at all is the platform's problem, not nobody's.
func TestAnOwnerlessPublicationGoesToAdmins(t *testing.T) {
	ctx := context.Background()
	st := store.NewMemory()
	svc := notify.New(st, nil, nil)

	svc.ChartVersionAvailable(ctx, nil, &models.ChartPublication{ID: "p3", ChartName: "orphan"}, "1.1.0")
	if got := unread(t, st, reader("padmin", "admin")); got != 1 {
		t.Fatalf("want the admin told, got %d", got)
	}
}
