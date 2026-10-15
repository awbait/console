package maintenance

import (
	"context"
	"errors"
	"testing"
	"time"

	"console/internal/notify"
	"console/internal/store"
	"console/pkg/models"
)

var (
	admin  = &models.User{Subject: "admin-1", Name: "Admin", Role: models.RoleAdmin}
	member = &models.User{Subject: "dev-1", Name: "Dev", Role: models.RoleMember, Teams: []string{"core"}}
)

type clock struct{ t time.Time }

func (c *clock) now() time.Time               { return c.t }
func (c *clock) add(d time.Duration)          { c.t = c.t.Add(d) }
func at(c *clock, d time.Duration) *time.Time { t := c.t.Add(d); return &t }

// harness is a service on an in-memory store with a clock the test moves and a
// record of the sweeps it asked for.
type harness struct {
	svc    *Service
	st     *store.Memory
	clk    *clock
	sweeps []string
}

func newHarness(t *testing.T, force bool) *harness {
	t.Helper()
	h := &harness{st: store.NewMemory(), clk: &clock{t: time.Date(2026, 10, 15, 9, 0, 0, 0, time.UTC)}}
	h.svc = New(h.st, notify.New(h.st, nil, nil), func(r string) { h.sweeps = append(h.sweeps, r) }, force, nil)
	h.svc.now = h.clk.now
	h.st.SetClock(h.clk.now)
	return h
}

// kinds lists the kinds of notification a reader of this role sees, oldest first.
func (h *harness) kinds(t *testing.T, role models.Role) []string {
	t.Helper()
	list, err := h.st.ListNotifications(context.Background(), store.NotificationFilter{
		Subject: "reader-" + string(role), Role: string(role), Limit: 100,
	})
	if err != nil {
		t.Fatal(err)
	}
	out := make([]string, 0, len(list))
	for i := len(list) - 1; i >= 0; i-- {
		out = append(out, list[i].Kind)
	}
	return out
}

func (h *harness) actions(t *testing.T) []string {
	t.Helper()
	ev, err := h.svc.History(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	out := make([]string, 0, len(ev))
	for i := len(ev) - 1; i >= 0; i-- {
		out = append(out, ev[i].Action)
	}
	return out
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// Switched on at once: on for members, open for admins, the loops held, and
// one word to everybody.
func TestStartNow(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t, false)
	st, err := h.svc.Set(ctx, admin, Input{EndsAt: at(h.clk, time.Hour), Message: "  DB upgrade  ", PauseBackground: true})
	if err != nil {
		t.Fatal(err)
	}
	if st.State != models.MaintenanceActive || st.Window.Message != "DB upgrade" || !st.Window.StartsAt.Equal(h.clk.t) {
		t.Fatalf("status: %+v %+v", st, st.Window)
	}
	if !h.svc.Blocks(ctx, member) || h.svc.Blocks(ctx, admin) {
		t.Fatal("members are locked out, admins are not")
	}
	if !h.svc.PausesBackground(ctx) {
		t.Fatal("the loops must be held")
	}
	if got := h.kinds(t, models.RoleMember); !equal(got, []string{models.NotifyMaintenanceStarted}) {
		t.Fatalf("notifications: %v", got)
	}
	if got := h.actions(t); !equal(got, []string{models.MaintenanceStartedAction}) {
		t.Fatalf("history: %v", got)
	}
}

// Announced for later: everybody works until the start, then it is on by the
// clock alone, with no write in between.
func TestScheduledTurnsOnByClock(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t, false)
	st, err := h.svc.Set(ctx, admin, Input{StartsAt: at(h.clk, 2*time.Hour), EndsAt: at(h.clk, 3*time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	if st.State != models.MaintenanceScheduled || h.svc.Blocks(ctx, member) || h.svc.PausesBackground(ctx) {
		t.Fatalf("scheduled must not block: %+v", st)
	}
	h.clk.add(2*time.Hour + cacheTTL)
	if !h.svc.Blocks(ctx, member) {
		t.Fatal("on at the start")
	}
	if h.svc.PausesBackground(ctx) {
		t.Fatal("pause_background was off")
	}
	if got := h.kinds(t, models.RoleMember); !equal(got, []string{models.NotifyMaintenanceScheduled}) {
		t.Fatalf("notifications: %v", got)
	}
}

func TestValidation(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t, false)
	long := make([]rune, MaxMessage+1)
	for i := range long {
		long[i] = 'x'
	}
	cases := []struct {
		name        string
		in          Input
		field, code string
	}{
		{"message too long", Input{Message: string(long)}, "message", CodeTooLong},
		{"end before start", Input{StartsAt: at(h.clk, 2*time.Hour), EndsAt: at(h.clk, time.Hour)}, "ends_at", CodeBeforeStart},
		{"end in the past", Input{EndsAt: at(h.clk, -time.Minute)}, "ends_at", CodeBeforeStart},
		{"auto end without end", Input{AutoEnd: true}, "auto_end", CodeNeedsEnd},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := h.svc.Set(ctx, admin, c.in)
			var ve *ValidationError
			if !errors.As(err, &ve) || ve.Field != c.field || ve.Code != c.code {
				t.Fatalf("want %s/%s, got %v", c.field, c.code, err)
			}
		})
	}
	if _, err := h.st.GetMaintenance(ctx); !errors.Is(err, models.ErrNotFound) {
		t.Fatal("a refused input must store nothing")
	}
}

// Extending a window that is on: the start stays where it happened, the end
// moves, everybody hears the new end, and an end already gone is refused.
func TestExtend(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t, false)
	first, err := h.svc.Set(ctx, admin, Input{EndsAt: at(h.clk, time.Hour), PauseBackground: true})
	if err != nil {
		t.Fatal(err)
	}
	h.clk.add(30 * time.Minute)
	st, err := h.svc.Set(ctx, admin, Input{StartsAt: at(h.clk, time.Hour), EndsAt: at(h.clk, 2*time.Hour), PauseBackground: true})
	if err != nil {
		t.Fatal(err)
	}
	if !st.Window.StartsAt.Equal(first.Window.StartsAt) || st.Window.ID != first.Window.ID {
		t.Fatalf("an active window keeps its start and id: %+v", st.Window)
	}
	if !st.Window.EndsAt.Equal(h.clk.t.Add(2 * time.Hour)) {
		t.Fatalf("end: %v", st.Window.EndsAt)
	}
	// The message alone changing is not news for the bell.
	if _, err := h.svc.Set(ctx, admin, Input{EndsAt: st.Window.EndsAt, Message: "still at it", PauseBackground: true}); err != nil {
		t.Fatal(err)
	}
	if got := h.kinds(t, models.RoleMember); !equal(got, []string{models.NotifyMaintenanceStarted, models.NotifyMaintenanceChanged}) {
		t.Fatalf("notifications: %v", got)
	}
	if got := h.actions(t); !equal(got, []string{"started", "changed", "changed"}) {
		t.Fatalf("history: %v", got)
	}
	if _, err := h.svc.Set(ctx, admin, Input{EndsAt: at(h.clk, -time.Minute)}); err == nil {
		t.Fatal("an end in the past must be refused")
	}
}

// Ending a window that held the loops lets them go at once; calling off one
// that has not started is a cancellation and sweeps nothing.
func TestEndAndCancel(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t, false)
	if _, err := h.svc.End(ctx, admin); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("nothing to end: %v", err)
	}
	if _, err := h.svc.Set(ctx, admin, Input{PauseBackground: true}); err != nil {
		t.Fatal(err)
	}
	st, err := h.svc.End(ctx, admin)
	if err != nil {
		t.Fatal(err)
	}
	if st.State != models.MaintenanceOff || h.svc.Blocks(ctx, member) || len(h.sweeps) != 1 {
		t.Fatalf("after end: %+v, sweeps %v", st, h.sweeps)
	}

	if _, err := h.svc.Set(ctx, admin, Input{StartsAt: at(h.clk, time.Hour), PauseBackground: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := h.svc.End(ctx, admin); err != nil {
		t.Fatal(err)
	}
	if len(h.sweeps) != 1 {
		t.Fatalf("a cancelled window held nothing: %v", h.sweeps)
	}
	if got := h.actions(t); !equal(got, []string{"started", "ended", "scheduled", "cancelled"}) {
		t.Fatalf("history: %v", got)
	}
	want := []string{models.NotifyMaintenanceStarted, models.NotifyMaintenanceEnded, models.NotifyMaintenanceScheduled, models.NotifyMaintenanceEnded}
	if got := h.kinds(t, models.RoleMember); !equal(got, want) {
		t.Fatalf("notifications: %v", got)
	}
}

// Turning the pause off on a window that is on lets the loops go too.
func TestUnpauseSweeps(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t, false)
	if _, err := h.svc.Set(ctx, admin, Input{PauseBackground: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := h.svc.Set(ctx, admin, Input{PauseBackground: false}); err != nil {
		t.Fatal(err)
	}
	if len(h.sweeps) != 1 || h.svc.PausesBackground(ctx) {
		t.Fatalf("sweeps %v", h.sweeps)
	}
}

// A window that ends by itself is off at its end with no write, and the tick
// records the end, tells everybody and lets the loops go.
func TestAutoEnd(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t, false)
	if _, err := h.svc.Set(ctx, admin, Input{EndsAt: at(h.clk, time.Hour), AutoEnd: true, PauseBackground: true}); err != nil {
		t.Fatal(err)
	}
	h.clk.add(time.Hour + cacheTTL)
	if h.svc.Blocks(ctx, member) {
		t.Fatal("off at the planned end")
	}
	if err := h.svc.Tick(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := h.st.GetMaintenance(ctx); !errors.Is(err, models.ErrNotFound) {
		t.Fatal("the tick must clear the window")
	}
	if got := h.actions(t); !equal(got, []string{"started", "auto_ended"}) {
		t.Fatalf("history: %v", got)
	}
	if len(h.sweeps) != 1 {
		t.Fatalf("sweeps %v", h.sweeps)
	}
	if err := h.svc.Tick(ctx); err != nil {
		t.Fatal("a second tick has nothing to do")
	}
}

// Without auto end a window past its end stays on, reads as overdue, and the
// admins hear about it once per planned end.
func TestOverdue(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t, false)
	if _, err := h.svc.Set(ctx, admin, Input{EndsAt: at(h.clk, time.Hour)}); err != nil {
		t.Fatal(err)
	}
	h.clk.add(time.Hour + cacheTTL)
	st := h.svc.Status(ctx)
	if st.State != models.MaintenanceActive || !st.Overdue || !st.Public().Overdue {
		t.Fatalf("overdue: %+v", st)
	}
	for range 2 {
		if err := h.svc.Tick(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if got := h.kinds(t, models.RoleAdmin); !equal(got, []string{models.NotifyMaintenanceStarted, models.NotifyMaintenanceOverdue}) {
		t.Fatalf("admin notifications: %v", got)
	}
	if got := h.kinds(t, models.RoleMember); !equal(got, []string{models.NotifyMaintenanceStarted}) {
		t.Fatalf("overdue is for admins only: %v", got)
	}
}

// The reminder goes out once, shortly before the start, and only for a window
// announced before that moment.
func TestReminder(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t, false)
	if _, err := h.svc.Set(ctx, admin, Input{StartsAt: at(h.clk, time.Hour)}); err != nil {
		t.Fatal(err)
	}
	if err := h.svc.Tick(ctx); err != nil {
		t.Fatal(err)
	}
	h.clk.add(50 * time.Minute)
	for range 2 {
		if err := h.svc.Tick(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if got := h.kinds(t, models.RoleMember); !equal(got, []string{models.NotifyMaintenanceScheduled, models.NotifyMaintenanceSoon}) {
		t.Fatalf("notifications: %v", got)
	}

	late := newHarness(t, false)
	if _, err := late.svc.Set(ctx, admin, Input{StartsAt: at(late.clk, 10*time.Minute)}); err != nil {
		t.Fatal(err)
	}
	if err := late.svc.Tick(ctx); err != nil {
		t.Fatal(err)
	}
	if got := late.kinds(t, models.RoleMember); !equal(got, []string{models.NotifyMaintenanceScheduled}) {
		t.Fatalf("announced inside the reminder period: %v", got)
	}
}

// MAINTENANCE_FORCE: on and holding the loops with nothing in the database.
func TestForce(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t, true)
	st := h.svc.Status(ctx)
	if st.State != models.MaintenanceActive || !st.Forced || st.Window != nil {
		t.Fatalf("forced: %+v", st)
	}
	if !h.svc.Blocks(ctx, member) || h.svc.Blocks(ctx, admin) || !h.svc.PausesBackground(ctx) {
		t.Fatal("forced maintenance blocks members and holds the loops")
	}
}

// A read that fails keeps the window last seen: a database hiccup neither
// opens nor closes the portal.
func TestReadFailureKeepsLastWindow(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t, false)
	if _, err := h.svc.Set(ctx, admin, Input{}); err != nil {
		t.Fatal(err)
	}
	if !h.svc.Blocks(ctx, member) {
		t.Fatal("on")
	}
	h.svc.store = failing{h.st}
	h.clk.add(cacheTTL)
	if !h.svc.Blocks(ctx, member) {
		t.Fatal("a failed read must keep the window known")
	}
}

type failing struct{ *store.Memory }

func (failing) GetMaintenance(context.Context) (*models.MaintenanceWindow, error) {
	return nil, errors.New("db down")
}
