package publications_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"console/internal/cache"
	"console/internal/events"
	"console/internal/publications"
	"console/pkg/models"
)

// editingSetup is setup with leases and a bus wired, plus a publication owned
// by team core, the way main wires the service.
func editingSetup(t *testing.T) (*publications.Service, *models.ChartPublication, events.Bus) {
	t.Helper()
	svc, _ := setup(t)
	bus := events.New()
	svc.SetLeases(cache.NewMemory())
	svc.SetBus(bus)
	p, err := svc.Create(context.Background(), member("core"), publications.CreateInput{
		ChartProject: "platform", ChartName: "ingress-gateway", CategoryID: "network", OwnerTeam: "core",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	return svc, p, bus
}

func named(subject, name string, teams ...string) *models.User {
	return &models.User{Subject: subject, Name: name, Teams: teams, Role: models.RoleMember}
}

// expectEvent waits for the next event on ch and checks its type.
func expectEvent(t *testing.T, ch <-chan events.Event, typ string) events.Event {
	t.Helper()
	select {
	case e := <-ch:
		if e.Type != typ {
			t.Fatalf("event = %s, want %s", e.Type, typ)
		}
		return e
	case <-time.After(time.Second):
		t.Fatalf("no %s event", typ)
		return events.Event{}
	}
}

// TestEditLeaseOnePersonAtATime: the first to take a version document holds
// it, renews it, and everybody else on the team is refused by name until it is
// released; saving and submitting under somebody else's lease are refused the
// same way.
func TestEditLeaseOnePersonAtATime(t *testing.T) {
	ctx := context.Background()
	svc, p, bus := editingSetup(t)
	alice := named("u-alice", "Alice", "core")
	bob := named("u-bob", "Bob", "core")
	ch, unsub := bus.Subscribe(publications.VersionTopic(p.ID, "1.0.0"))
	defer unsub()

	ed, err := svc.AcquireEdit(ctx, alice, p.ID, "1.0.0", false)
	if err != nil || ed.Subject != "u-alice" || ed.Name != "Alice" || ed.Until.Sub(ed.Since) != publications.EditLeaseTTL {
		t.Fatalf("alice acquire: %+v, %v", ed, err)
	}
	expectEvent(t, ch, "edit_acquired")

	// A renewal keeps "since" and announces nothing: the page does it every
	// few seconds.
	again, err := svc.AcquireEdit(ctx, alice, p.ID, "1.0.0", false)
	if err != nil || !again.Since.Equal(ed.Since) {
		t.Fatalf("alice renew: %+v, %v", again, err)
	}
	select {
	case e := <-ch:
		t.Fatalf("renewal published %s", e.Type)
	default:
	}

	// Bob is refused and told who.
	_, err = svc.AcquireEdit(ctx, bob, p.ID, "1.0.0", false)
	var locked *publications.EditLockedError
	if !errors.As(err, &locked) || locked.Editor.Subject != "u-alice" || locked.Editor.Name != "Alice" {
		t.Fatalf("bob acquire: %v", err)
	}
	if !errors.Is(err, models.ErrConflict) {
		t.Fatalf("locked is not a conflict: %v", err)
	}

	// So is his save.
	if _, err := svc.SaveVersionView(ctx, bob, p.ID, "1.0.0", viewV1); !errors.As(err, &locked) {
		t.Fatalf("bob save: %v", err)
	}

	// Alice's save lands and is announced.
	if _, err := svc.SaveVersionView(ctx, alice, p.ID, "1.0.0", viewV1); err != nil {
		t.Fatalf("alice save: %v", err)
	}
	e := expectEvent(t, ch, "view_saved")
	if e.Data["chart_version"] != "1.0.0" {
		t.Fatalf("view_saved data: %+v", e.Data)
	}

	// Bob may not send her draft for review either.
	if _, err := svc.SubmitVersion(ctx, bob, p.ID, "1.0.0"); !errors.As(err, &locked) {
		t.Fatalf("bob submit: %v", err)
	}

	// Bob cannot release Alice's lease; Alice can, and then Bob takes it.
	if err := svc.ReleaseEdit(ctx, bob, p.ID, "1.0.0"); !errors.As(err, &locked) {
		t.Fatalf("bob release: %v", err)
	}
	if err := svc.ReleaseEdit(ctx, alice, p.ID, "1.0.0"); err != nil {
		t.Fatalf("alice release: %v", err)
	}
	expectEvent(t, ch, "edit_released")
	if cur, _ := svc.Editing(ctx, p.ID, "1.0.0"); cur != nil {
		t.Fatalf("still held after release: %+v", cur)
	}
	// Releasing what nobody holds is fine.
	if err := svc.ReleaseEdit(ctx, alice, p.ID, "1.0.0"); err != nil {
		t.Fatalf("alice release again: %v", err)
	}
	if ed, err := svc.AcquireEdit(ctx, bob, p.ID, "1.0.0", false); err != nil || ed.Subject != "u-bob" {
		t.Fatalf("bob acquire after release: %+v, %v", ed, err)
	}
}

// TestEditLeaseSaveTakesAFreeLease: a save without a lease (the page closing,
// a lease that lapsed) is not refused; it takes the lease for its author.
func TestEditLeaseSaveTakesAFreeLease(t *testing.T) {
	ctx := context.Background()
	svc, p, _ := editingSetup(t)
	bob := named("u-bob", "Bob", "core")
	if _, err := svc.SaveVersionView(ctx, bob, p.ID, "2.0.0", viewV1); err != nil {
		t.Fatalf("save: %v", err)
	}
	cur, err := svc.Editing(ctx, p.ID, "2.0.0")
	if err != nil || cur == nil || cur.Subject != "u-bob" {
		t.Fatalf("editing after save: %+v, %v", cur, err)
	}
}

// TestEditLeaseForce: only an administrator takes a document over somebody,
// and the previous holder is refused from then on.
func TestEditLeaseForce(t *testing.T) {
	ctx := context.Background()
	svc, p, _ := editingSetup(t)
	alice := named("u-alice", "Alice", "core")
	bob := named("u-bob", "Bob", "core")
	if _, err := svc.AcquireEdit(ctx, alice, p.ID, "1.0.0", false); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AcquireEdit(ctx, bob, p.ID, "1.0.0", true); !errors.Is(err, publications.ErrForbidden) {
		t.Fatalf("member force: %v", err)
	}
	ed, err := svc.AcquireEdit(ctx, admin(), p.ID, "1.0.0", true)
	if err != nil || ed.Subject != "u-admin" {
		t.Fatalf("admin force: %+v, %v", ed, err)
	}
	var locked *publications.EditLockedError
	if _, err := svc.SaveVersionView(ctx, alice, p.ID, "1.0.0", viewV1); !errors.As(err, &locked) || locked.Editor.Subject != "u-admin" {
		t.Fatalf("alice save after seize: %v", err)
	}
}

// TestEditLeaseAuthorization: the lease follows the right to manage the
// publication, and a service without leases wired refuses nobody.
func TestEditLeaseAuthorization(t *testing.T) {
	ctx := context.Background()
	svc, p, _ := editingSetup(t)
	outsider := named("u-eve", "Eve", "other")
	if _, err := svc.AcquireEdit(ctx, outsider, p.ID, "1.0.0", false); !errors.Is(err, publications.ErrForbidden) {
		t.Fatalf("outsider acquire: %v", err)
	}
	if err := svc.ReleaseEdit(ctx, outsider, p.ID, "1.0.0"); !errors.Is(err, publications.ErrForbidden) {
		t.Fatalf("outsider release: %v", err)
	}
	if _, err := svc.AcquireEdit(ctx, member("core"), "missing", "1.0.0", false); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("missing publication: %v", err)
	}

	bare, _ := setup(t)
	bp, err := bare.Create(ctx, member("core"), publications.CreateInput{
		ChartProject: "platform", ChartName: "egress-gateway", CategoryID: "network", OwnerTeam: "core",
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, u := range []*models.User{named("u-alice", "Alice", "core"), named("u-bob", "Bob", "core")} {
		if ed, err := bare.AcquireEdit(ctx, u, bp.ID, "1.0.0", false); err != nil || ed.Subject != u.Subject {
			t.Fatalf("no leases wired, %s acquire: %+v, %v", u.Subject, ed, err)
		}
	}
	if cur, err := bare.Editing(ctx, bp.ID, "1.0.0"); err != nil || cur != nil {
		t.Fatalf("no leases wired, editing: %+v, %v", cur, err)
	}
}
