package activity

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"console/internal/auth"
	"console/internal/cache"
	"console/internal/store"
	"console/pkg/models"
)

func newRecorder(t *testing.T) (*Recorder, *store.Memory, *cache.Memory) {
	t.Helper()
	st := store.NewMemory()
	c := cache.NewMemory()
	return New(st, c, c, nil), st, c
}

func user(sub, name string, teams ...string) *models.User {
	return &models.User{Subject: sub, Name: name, Teams: teams, Role: models.RoleMember}
}

// The directory must not take a write per request: that is the whole reason the
// throttle exists (hundreds of updates a minute otherwise). Presence, which is
// cheap and is what "online" is read from, is written every time.
func TestTouchThrottlesTheDirectory(t *testing.T) {
	rec, st, c := newRecorder(t)
	ctx := context.Background()
	u := user("u1", "Ada", "core")

	for range 5 {
		rec.Touch(ctx, u)
	}
	users, err := st.ListUsers(ctx)
	if err != nil {
		t.Fatalf("list users: %v", err)
	}
	if len(users) != 1 {
		t.Fatalf("want one directory row, got %d", len(users))
	}
	if users[0].Visits != 1 {
		t.Fatalf("five requests inside one window must count as one visit, got %d", users[0].Visits)
	}
	seen, err := c.Since(ctx, presenceKey, time.Now().Add(-OnlineWindow))
	if err != nil || len(seen) != 1 {
		t.Fatalf("presence: %v %v", seen, err)
	}

	// Once the window is over (here: the throttle flag is gone), the next
	// request writes again.
	if err := c.Delete(ctx, touchKey+"u1"); err != nil {
		t.Fatalf("clear throttle: %v", err)
	}
	rec.Touch(ctx, u)
	users, _ = st.ListUsers(ctx)
	if users[0].Visits != 2 {
		t.Fatalf("want a second visit after the window, got %d", users[0].Visits)
	}
}

// A token that carries fewer claims than the last one must not blank out what
// the portal already knows about a person.
func TestTouchKeepsKnownName(t *testing.T) {
	rec, st, c := newRecorder(t)
	ctx := context.Background()

	rec.Touch(ctx, &models.User{Subject: "u1", Name: "Ada", Email: "ada@example.org", Teams: []string{"core"}})
	_ = c.Delete(ctx, touchKey+"u1")
	rec.Touch(ctx, &models.User{Subject: "u1", Teams: []string{"core"}})

	users, _ := st.ListUsers(ctx)
	if users[0].Name != "Ada" || users[0].Email != "ada@example.org" {
		t.Fatalf("a thinner token erased the profile: %+v", users[0])
	}
}

// Overview is what both the page and the gauges read, so its arithmetic is the
// thing worth pinning: who counts as online, as active, and how teams add up.
func TestOverviewCountsPeopleAndTeams(t *testing.T) {
	rec, st, c := newRecorder(t)
	ctx := context.Background()
	now := time.Date(2026, 8, 23, 12, 0, 0, 0, time.UTC)
	rec.now = func() time.Time { return now }

	seed := func(sub, name string, ago time.Duration, teams ...string) {
		t.Helper()
		if err := st.TouchUser(ctx, &models.PlatformUser{
			Subject: sub, Name: name, Teams: teams, Role: models.RoleMember, LastSeen: now.Add(-ago),
		}); err != nil {
			t.Fatalf("seed %s: %v", sub, err)
		}
	}
	seed("u1", "Ada", time.Minute, "core")
	seed("u2", "Grace", 3*time.Hour, "core", "data")
	seed("u3", "Alan", 4*24*time.Hour, "data")
	seed("u4", "Edsger", 30*24*time.Hour)
	// Only u1 is here right now; u2 was here half an hour ago, which is outside
	// the window.
	_ = c.Touch(ctx, presenceKey, "u1", now.Add(-time.Minute))
	_ = c.Touch(ctx, presenceKey, "u2", now.Add(-30*time.Minute))

	ov, err := rec.Overview(ctx)
	if err != nil {
		t.Fatalf("overview: %v", err)
	}
	want := Totals{Users: 4, Online: 1, Active24h: 2, Active7d: 3, Teams: 2}
	if ov.Totals != want {
		t.Fatalf("totals: got %+v want %+v", ov.Totals, want)
	}
	if len(ov.Online) != 1 || ov.Online[0].Subject != "u1" || !ov.Online[0].Online {
		t.Fatalf("online: %+v", ov.Online)
	}
	byTeam := map[string]*models.TeamActivity{}
	for _, tm := range ov.Teams {
		byTeam[tm.Team] = tm
	}
	if core := byTeam["core"]; core == nil || core.Members != 2 || core.Online != 1 || core.Active24h != 2 {
		t.Fatalf("core: %+v", core)
	}
	if data := byTeam["data"]; data == nil || data.Members != 2 || data.Online != 0 || data.Active24h != 1 {
		t.Fatalf("data: %+v", data)
	}
	// Someone with no team is still a person the portal has seen; they just do
	// not add a team to the list.
	if len(ov.Users) != 4 {
		t.Fatalf("directory: %d rows", len(ov.Users))
	}
}

// The directory row is written at most once every few minutes and presence on
// every request, so for somebody who is here the two disagree by design. The
// page must not show both: a person read as "только что" in the online list and
// "5 мин назад" in the table on the same screen.
func TestOverviewTakesTheFresherTime(t *testing.T) {
	rec, st, c := newRecorder(t)
	ctx := context.Background()
	now := time.Now()
	rec.now = func() time.Time { return now }

	if err := st.TouchUser(ctx, &models.PlatformUser{
		Subject: "u1", Name: "Ada", Teams: []string{"core"}, LastSeen: now.Add(-4 * time.Minute),
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	_ = c.Touch(ctx, presenceKey, "u1", now.Add(-10*time.Second))

	ov, err := rec.Overview(ctx)
	if err != nil {
		t.Fatalf("overview: %v", err)
	}
	if got := now.Sub(ov.Users[0].LastSeen); got > time.Minute {
		t.Fatalf("directory kept the stale time: %s behind presence", got)
	}
	if ov.Online[0].SeenAgo > 60 {
		t.Fatalf("online list: %d seconds ago", ov.Online[0].SeenAgo)
	}
}

// Presence outlives nothing: a set nobody prunes is every person who has ever
// signed in, kept forever, and read only for the last five minutes.
func TestPruneDropsStalePresence(t *testing.T) {
	rec, _, c := newRecorder(t)
	ctx := context.Background()
	now := time.Now()
	rec.now = func() time.Time { return now }

	_ = c.Touch(ctx, presenceKey, "here", now.Add(-time.Minute))
	_ = c.Touch(ctx, presenceKey, "gone", now.Add(-2*time.Hour))
	if err := rec.Prune(ctx); err != nil {
		t.Fatalf("prune: %v", err)
	}
	// Ask well beyond the window: what prune removed must be gone for good, not
	// merely outside the online range.
	seen, _ := c.Since(ctx, presenceKey, now.Add(-24*time.Hour))
	if len(seen) != 1 || seen[0].Member != "here" {
		t.Fatalf("prune left: %+v", seen)
	}
}

// The middleware is the only thing that records in production, and it does so
// after the response is on its way. What it must not do is skip an
// authenticated caller or record an anonymous one.
func TestMiddlewareRecordsTheCaller(t *testing.T) {
	rec, st, _ := newRecorder(t)
	h := rec.Middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	anon := httptest.NewRequest("GET", "/api/v1/charts", nil)
	h.ServeHTTP(httptest.NewRecorder(), anon)
	rec.Wait()
	if users, _ := st.ListUsers(context.Background()); len(users) != 0 {
		t.Fatalf("anonymous request recorded: %+v", users)
	}

	req := httptest.NewRequest("GET", "/api/v1/charts", nil)
	req = req.WithContext(auth.WithUser(req.Context(), user("u1", "Ada", "core")))
	h.ServeHTTP(httptest.NewRecorder(), req)
	rec.Wait()
	users, _ := st.ListUsers(context.Background())
	if len(users) != 1 || users[0].Subject != "u1" {
		t.Fatalf("caller not recorded: %+v", users)
	}
}
