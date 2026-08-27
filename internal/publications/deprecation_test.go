package publications_test

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"console/internal/publications"
	"console/internal/store"
	"console/pkg/models"
)

// Taking a version out of support is the one thing the portal lets an owner do
// to a version and then refuses everything else about: these tests walk each
// door that has to be shut, and the one that has to stay open.

func TestDeprecateVersionClosesEveryChange(t *testing.T) {
	ctx := context.Background()
	svc, _ := setup(t)
	owner := member("core")
	p := newPub(t, svc, owner, "ingress-gateway")
	publishVersion(t, svc, owner, p.ID, "1.0.0", viewV1)

	v, err := svc.DeprecateVersion(ctx, owner, p.ID, "1.0.0", "перешли на 2.x")
	if err != nil {
		t.Fatalf("deprecate: %v", err)
	}
	if !v.Deprecated() || v.DeprecationNote != "перешли на 2.x" || v.DeprecatedBy != owner.Subject {
		t.Fatalf("deprecation not recorded: %+v", v)
	}
	// Out of the catalog, and out of every answer to "what can be ordered".
	if v.Orderable || v.Published() {
		t.Fatalf("a deprecated version must leave the catalog: %+v", v)
	}
	cv, err := svc.CatalogVersions(ctx, p, []string{"1.0.0"})
	if err != nil {
		t.Fatalf("catalog: %v", err)
	}
	if len(cv.Orderable) != 0 || cv.Recommended != nil {
		t.Fatalf("nothing must be orderable: %+v", cv)
	}
	if len(cv.Deprecated) != 1 || cv.Deprecated[0].ChartVersion != "1.0.0" {
		t.Fatalf("catalog must name the deprecated version: %+v", cv.Deprecated)
	}
	if cv.Deprecated[0].DeprecationNote != "перешли на 2.x" || cv.Deprecated[0].DeprecatedAt == nil {
		t.Fatalf("the catalog must carry the date and the reason: %+v", cv.Deprecated[0])
	}

	// Every way of changing the version answers with a conflict, and the same one.
	refused := map[string]func() error{
		"save": func() error {
			_, err := svc.SaveVersionView(ctx, owner, p.ID, "1.0.0", viewV2)
			return err
		},
		"submit": func() error {
			_, err := svc.SubmitVersion(ctx, owner, p.ID, "1.0.0")
			return err
		},
		"approve": func() error {
			_, err := svc.ApproveVersion(ctx, admin(), p.ID, "1.0.0")
			return err
		},
		"reject": func() error {
			_, err := svc.RejectVersion(ctx, admin(), p.ID, "1.0.0", "нет")
			return err
		},
		"orderable": func() error {
			_, err := svc.SetVersionOrderable(ctx, owner, p.ID, "1.0.0", true)
			return err
		},
		"recommend": func() error {
			return svc.SetRecommendedVersion(ctx, owner, p.ID, "1.0.0")
		},
	}
	for name, call := range refused {
		if err := call(); !errors.Is(err, models.ErrConflict) {
			t.Errorf("%s on a deprecated version: want conflict, got %v", name, err)
		}
	}

	// Putting it back is the only way through, and it leaves the approval status
	// where it was.
	back, err := svc.UndeprecateVersion(ctx, owner, p.ID, "1.0.0")
	if err != nil {
		t.Fatalf("undeprecate: %v", err)
	}
	if back.Deprecated() || back.DeprecationNote != "" || back.Status != models.PubApproved {
		t.Fatalf("undeprecate must clear the mark and keep the status: %+v", back)
	}
	// It does not walk back into the catalog by itself: offering it again is a
	// separate decision.
	if back.Orderable {
		t.Fatalf("undeprecate must not put the version back in the catalog")
	}
	if _, err := svc.SetVersionOrderable(ctx, owner, p.ID, "1.0.0", true); err != nil {
		t.Fatalf("orderable after undeprecate: %v", err)
	}
}

// The recommendation is a pointer at one version; taking that version out of
// support has to move it, or the service recommends something nobody can order.
func TestDeprecateRecommendedFallsToTheNext(t *testing.T) {
	ctx := context.Background()
	svc, _ := setup(t)
	owner := member("core")
	p := newPub(t, svc, owner, "ingress-gateway")
	publishVersion(t, svc, owner, p.ID, "1.0.0", viewV1)
	publishVersion(t, svc, owner, p.ID, "2.0.0", viewV1)
	if err := svc.SetRecommendedVersion(ctx, owner, p.ID, "2.0.0"); err != nil {
		t.Fatalf("recommend: %v", err)
	}

	if _, err := svc.DeprecateVersion(ctx, owner, p.ID, "2.0.0", ""); err != nil {
		t.Fatalf("deprecate: %v", err)
	}
	cv, err := svc.CatalogVersions(ctx, p, []string{"1.0.0", "2.0.0"})
	if err != nil {
		t.Fatalf("catalog: %v", err)
	}
	if cv.Recommended == nil || cv.Recommended.ChartVersion != "1.0.0" {
		t.Fatalf("recommendation must fall to 1.0.0, got %+v", cv.Recommended)
	}
	if len(cv.Orderable) != 1 || cv.Orderable[0] != "1.0.0" {
		t.Fatalf("only 1.0.0 stays orderable, got %v", cv.Orderable)
	}
}

// A version sitting in the admin's queue leaves it in the same move: otherwise
// the queue keeps offering a decision on something already buried.
func TestDeprecatePendingLeavesTheQueue(t *testing.T) {
	ctx := context.Background()
	svc, _ := setup(t)
	owner := member("core")
	p := newPub(t, svc, owner, "ingress-gateway")
	publishVersion(t, svc, owner, p.ID, "1.0.0", viewV1)
	// A new draft of the same version, sent for review.
	if _, err := svc.SaveVersionView(ctx, owner, p.ID, "1.0.0", viewV2); err != nil {
		t.Fatalf("save: %v", err)
	}
	if _, err := svc.SubmitVersion(ctx, owner, p.ID, "1.0.0"); err != nil {
		t.Fatalf("submit: %v", err)
	}

	v, err := svc.DeprecateVersion(ctx, owner, p.ID, "1.0.0", "")
	if err != nil {
		t.Fatalf("deprecate pending: %v", err)
	}
	if v.Status == models.PubPending {
		t.Fatalf("a deprecated version must leave the review queue: %+v", v)
	}
	queue, err := svc.PendingVersions(ctx)
	if err != nil {
		t.Fatalf("queue: %v", err)
	}
	if len(queue) != 0 {
		t.Fatalf("queue must be empty, got %+v", queue)
	}
}

// A draft nobody ever approved was never offered to anyone, so there is nothing
// to take out of support.
func TestDeprecateNeedsAnApprovedVersion(t *testing.T) {
	ctx := context.Background()
	svc, _ := setup(t)
	owner := member("core")
	p := newPub(t, svc, owner, "ingress-gateway")
	if _, err := svc.SaveVersionView(ctx, owner, p.ID, "1.0.0", viewV1); err != nil {
		t.Fatalf("save: %v", err)
	}
	if _, err := svc.DeprecateVersion(ctx, owner, p.ID, "1.0.0", ""); !errors.Is(err, models.ErrConflict) {
		t.Fatalf("want conflict on a never-approved draft, got %v", err)
	}
}

// Support is the owner's or the admin's call, by the same rights as everything
// else about the version.
func TestDeprecateRights(t *testing.T) {
	ctx := context.Background()
	svc, _ := setup(t)
	owner := member("core")
	p := newPub(t, svc, owner, "ingress-gateway")
	publishVersion(t, svc, owner, p.ID, "1.0.0", viewV1)

	if _, err := svc.DeprecateVersion(ctx, member("other"), p.ID, "1.0.0", ""); !errors.Is(err, publications.ErrForbidden) {
		t.Fatalf("a stranger must not deprecate, got %v", err)
	}
	if _, err := svc.DeprecateVersion(ctx, admin(), p.ID, "1.0.0", ""); err != nil {
		t.Fatalf("admin deprecate: %v", err)
	}
	if _, err := svc.UndeprecateVersion(ctx, member("other"), p.ID, "1.0.0"); !errors.Is(err, publications.ErrForbidden) {
		t.Fatalf("a stranger must not undeprecate, got %v", err)
	}
}

// The message goes to the teams that are actually running the version, and it
// carries the reason and where to go instead.
func TestDeprecateTellsTheTeamsRunningIt(t *testing.T) {
	ctx := context.Background()
	svc, st := setup(t)
	rec := &recorder{}
	svc.SetNotifier(rec)
	owner := member("core")
	p := newPub(t, svc, owner, "ingress-gateway")
	publishVersion(t, svc, owner, p.ID, "1.0.0", viewV1)
	publishVersion(t, svc, owner, p.ID, "2.0.0", viewV1)

	order(t, st, p, "1.0.0", "payments", 1)
	order(t, st, p, "1.0.0", "payments", 2) // one team, two orders, one message
	order(t, st, p, "2.0.0", "search", 3)   // a different version: not this news

	if _, err := svc.DeprecateVersion(ctx, owner, p.ID, "1.0.0", "перешли на 2.0.0"); err != nil {
		t.Fatalf("deprecate: %v", err)
	}
	if len(rec.deprecated) != 1 {
		t.Fatalf("want one notification, got %+v", rec.deprecated)
	}
	got := rec.deprecated[0]
	if len(got.Teams) != 1 || got.Teams[0] != "payments" {
		t.Fatalf("only the team running it is told, got %v", got.Teams)
	}
	if got.Note != "перешли на 2.0.0" || got.MoveTo != "2.0.0" {
		t.Fatalf("the message must carry the reason and the replacement: %+v", got)
	}

	// Only "search" runs 2.0.0, and taking it out leaves the service with nothing
	// orderable, so the message names no replacement.
	if _, err := svc.DeprecateVersion(ctx, owner, p.ID, "2.0.0", ""); err != nil {
		t.Fatalf("deprecate 2.0.0: %v", err)
	}
	last := rec.deprecated[len(rec.deprecated)-1]
	if len(last.Teams) != 1 || last.Teams[0] != "search" || last.MoveTo != "" {
		t.Fatalf("want search told with no replacement, got %+v", last)
	}
}

// order files a live order of one chart version for a team.
func order(t *testing.T, st *store.Memory, p *models.ChartPublication, version, team string, n int) {
	t.Helper()
	r := &models.Request{
		ID:           fmt.Sprintf("order-%d", n),
		CreatedBy:    "u-" + team,
		Team:         team,
		ChartProject: p.ChartProject,
		ChartName:    p.ChartName,
		ChartVersion: version,
		ServiceName:  fmt.Sprintf("%s-%d", team, n),
		Status:       models.StatusHealthy,
	}
	if err := st.CreateRequest(context.Background(), r); err != nil {
		t.Fatalf("order: %v", err)
	}
}
