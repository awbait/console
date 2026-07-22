package publications_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"console/internal/publications"
	"console/internal/store"
	"console/pkg/models"
)

func member(teams ...string) *models.User {
	return &models.User{Subject: "u-member", Name: "Member", Teams: teams, Role: models.RoleMember}
}

func admin() *models.User {
	return &models.User{Subject: "u-admin", Name: "Admin", Role: models.RoleAdmin}
}

func setup(t *testing.T) (*publications.Service, *store.Memory) {
	t.Helper()
	st := store.NewMemory()
	if err := st.CreateCategory(context.Background(), &models.Category{ID: "network", Label: "Сеть"}); err != nil {
		t.Fatal(err)
	}
	return publications.New(st, nil), st
}

var viewV1 = json.RawMessage(`{"views":{"order":{"identity":"/gateways/0/name","include":["gateways"]}}}`)
var viewV2 = json.RawMessage(`{"views":{"order":{"identity":"/gateways/0/name","include":["gateways","naming"]}}}`)

// TestPublicationLifecycle drives the publication-level metadata FSM: propose a
// category/owner change -> submit -> approve/reject. View documents live on
// versions (versions_test.go); the publication itself carries no view.
func TestPublicationLifecycle(t *testing.T) {
	ctx := context.Background()
	svc, st := setup(t)
	if err := st.CreateCategory(ctx, &models.Category{ID: "databases", Label: "Базы"}); err != nil {
		t.Fatal(err)
	}
	owner := member("core")

	p, err := svc.Create(ctx, owner, publications.CreateInput{
		ChartProject: "platform", ChartName: "ingress-gateway",
		CategoryID: "network", OwnerTeam: "core",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if p.Status != models.PubDraft {
		t.Fatalf("want DRAFT, got %s", p.Status)
	}

	// duplicate chart is forbidden
	if _, err := svc.Create(ctx, owner, publications.CreateInput{
		ChartProject: "platform", ChartName: "ingress-gateway",
		CategoryID: "network", OwnerTeam: "core",
	}); !errors.Is(err, models.ErrConflict) {
		t.Fatalf("dup create: want conflict, got %v", err)
	}

	// propose a category change; submit -> PENDING; edits frozen
	to := "databases"
	if _, err := svc.Update(ctx, owner, p.ID, publications.UpdateInput{CategoryID: &to}); err != nil {
		t.Fatalf("propose category: %v", err)
	}
	p, err = svc.Submit(ctx, owner, p.ID)
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	if p.Status != models.PubPending {
		t.Fatalf("want PENDING, got %s", p.Status)
	}
	back := "network"
	if _, err := svc.Update(ctx, owner, p.ID, publications.UpdateInput{CategoryID: &back}); !errors.Is(err, publications.ErrPendingLocked) {
		t.Fatalf("update while pending: want ErrPendingLocked, got %v", err)
	}
	if _, err := svc.Submit(ctx, owner, p.ID); !errors.Is(err, models.ErrConflict) {
		t.Fatalf("double submit: want conflict, got %v", err)
	}

	// approve, admin only; the draft goes live
	if _, err := svc.Approve(ctx, owner, p.ID); !errors.Is(err, publications.ErrForbidden) {
		t.Fatalf("member approve: want forbidden, got %v", err)
	}
	p, err = svc.Approve(ctx, admin(), p.ID)
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	if p.Status != models.PubApproved || p.CategoryID != "databases" || p.DraftCategoryID != "" {
		t.Fatalf("approve must apply the draft: %s live=%s draft=%q", p.Status, p.CategoryID, p.DraftCategoryID)
	}

	// next change -> submit -> reject: the live value survives
	if _, err := svc.Update(ctx, owner, p.ID, publications.UpdateInput{CategoryID: &back}); err != nil {
		t.Fatalf("propose again: %v", err)
	}
	if _, err := svc.Submit(ctx, owner, p.ID); err != nil {
		t.Fatalf("submit again: %v", err)
	}
	p, err = svc.Reject(ctx, admin(), p.ID, "не та категория")
	if err != nil {
		t.Fatalf("reject: %v", err)
	}
	if p.Status != models.PubRejected || p.ReviewComment != "не та категория" {
		t.Fatalf("want REJECTED+comment, got %s %q", p.Status, p.ReviewComment)
	}
	if p.CategoryID != "databases" {
		t.Fatalf("live category must survive reject: %s", p.CategoryID)
	}

	// edit after reject (reverting the proposal clears the draft) returns to DRAFT
	live := "databases"
	p, err = svc.Update(ctx, owner, p.ID, publications.UpdateInput{CategoryID: &live})
	if err != nil {
		t.Fatalf("update after reject: %v", err)
	}
	if p.Status != models.PubDraft || p.DraftCategoryID != "" {
		t.Fatalf("want DRAFT with no draft after revert, got %s draft=%q", p.Status, p.DraftCategoryID)
	}

	// audit accumulated
	evs, err := svc.ListEvents(ctx, p.ID)
	if err != nil || len(evs) < 6 {
		t.Fatalf("events: %v n=%d", err, len(evs))
	}
}

func TestWithdraw(t *testing.T) {
	ctx := context.Background()
	svc, st := setup(t)
	owner := member("core")

	p, err := svc.Create(ctx, owner, publications.CreateInput{
		ChartProject: "platform", ChartName: "x", CategoryID: "network", OwnerTeam: "core",
	})
	if err != nil {
		t.Fatal(err)
	}

	// not from review, conflict
	if _, err := svc.Withdraw(ctx, owner, p.ID); !errors.Is(err, models.ErrConflict) {
		t.Fatalf("withdraw from draft: want conflict, got %v", err)
	}

	if err := st.CreateCategory(ctx, &models.Category{ID: "databases", Label: "Базы"}); err != nil {
		t.Fatal(err)
	}
	to := "databases"
	if _, err := svc.Update(ctx, owner, p.ID, publications.UpdateInput{CategoryID: &to}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Submit(ctx, owner, p.ID); err != nil {
		t.Fatal(err)
	}

	// foreign, not allowed
	if _, err := svc.Withdraw(ctx, member("dbaas"), p.ID); !errors.Is(err, publications.ErrForbidden) {
		t.Fatalf("foreign withdraw: want forbidden, got %v", err)
	}

	// owner withdraws -> DRAFT, edits open again
	p, err = svc.Withdraw(ctx, owner, p.ID)
	if err != nil {
		t.Fatalf("withdraw: %v", err)
	}
	if p.Status != models.PubDraft {
		t.Fatalf("want DRAFT after withdraw, got %s", p.Status)
	}
	back := "network"
	if _, err := svc.Update(ctx, owner, p.ID, publications.UpdateInput{CategoryID: &back}); err != nil {
		t.Fatalf("edit after withdraw: %v", err)
	}
}

func TestCreateRBACAndValidation(t *testing.T) {
	ctx := context.Background()
	svc, _ := setup(t)

	// foreign team
	if _, err := svc.Create(ctx, member("dbaas"), publications.CreateInput{
		ChartProject: "platform", ChartName: "x", CategoryID: "network", OwnerTeam: "core",
	}); !errors.Is(err, publications.ErrForbidden) {
		t.Fatalf("foreign team: want forbidden, got %v", err)
	}

	// nonexistent category
	var ve *publications.ValidationError
	if _, err := svc.Create(ctx, member("core"), publications.CreateInput{
		ChartProject: "platform", ChartName: "x", CategoryID: "nope", OwnerTeam: "core",
	}); !errors.As(err, &ve) {
		t.Fatalf("unknown category: want validation error, got %v", err)
	}

	// submit without any pending metadata change
	p, err := svc.Create(ctx, member("core"), publications.CreateInput{
		ChartProject: "platform", ChartName: "x", CategoryID: "network", OwnerTeam: "core",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Submit(ctx, member("core"), p.ID); !errors.As(err, &ve) {
		t.Fatalf("submit without changes: want validation error, got %v", err)
	}
}

func TestOwnerTeamHandoff(t *testing.T) {
	ctx := context.Background()
	svc, _ := setup(t)

	p, err := svc.Create(ctx, member("core", "dbaas"), publications.CreateInput{
		ChartProject: "platform", ChartName: "x", CategoryID: "network", OwnerTeam: "core",
	})
	if err != nil {
		t.Fatal(err)
	}

	// a non-owner cannot even propose a transfer
	to := "dbaas"
	if _, err := svc.Update(ctx, member("dbaas"), p.ID, publications.UpdateInput{OwnerTeam: &to}); !errors.Is(err, publications.ErrForbidden) {
		t.Fatalf("non-owner propose: want forbidden, got %v", err)
	}

	// can propose only to your own team; an admin, to any
	payments := "payments"
	if _, err := svc.Update(ctx, member("core"), p.ID, publications.UpdateInput{OwnerTeam: &payments}); !errors.Is(err, publications.ErrForbidden) {
		t.Fatalf("propose to foreign team: want forbidden, got %v", err)
	}
	if _, err := svc.Update(ctx, admin(), p.ID, publications.UpdateInput{OwnerTeam: &payments}); err != nil {
		t.Fatalf("admin propose anywhere: %v", err)
	}

	// owner proposes a transfer to their second team: this is only a draft,
	// the live owner does not change until approval
	p, err = svc.Update(ctx, member("core", "dbaas"), p.ID, publications.UpdateInput{OwnerTeam: &to})
	if err != nil {
		t.Fatalf("propose handoff: %v", err)
	}
	if p.OwnerTeam != "core" || p.DraftOwnerTeam != "dbaas" {
		t.Fatalf("handoff must be pending: owner=%s draft=%q", p.OwnerTeam, p.DraftOwnerTeam)
	}

	// applied only after approval
	if _, err := svc.Submit(ctx, member("core"), p.ID); err != nil {
		t.Fatalf("submit: %v", err)
	}
	p, err = svc.Approve(ctx, admin(), p.ID)
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	if p.OwnerTeam != "dbaas" || p.DraftOwnerTeam != "" {
		t.Fatalf("handoff must apply on approve: owner=%s draft=%q", p.OwnerTeam, p.DraftOwnerTeam)
	}
}

func TestMetadataApproval(t *testing.T) {
	ctx := context.Background()
	svc, st := setup(t)
	if err := st.CreateCategory(ctx, &models.Category{ID: "databases", Label: "Базы"}); err != nil {
		t.Fatal(err)
	}
	owner := member("core")

	p, err := svc.Create(ctx, owner, publications.CreateInput{
		ChartProject: "platform", ChartName: "pg", CategoryID: "network", OwnerTeam: "core",
	})
	if err != nil {
		t.Fatal(err)
	}

	// a category change is not applied immediately: only a draft
	to := "databases"
	p, err = svc.Update(ctx, owner, p.ID, publications.UpdateInput{CategoryID: &to})
	if err != nil {
		t.Fatalf("propose category: %v", err)
	}
	if p.CategoryID != "network" || p.DraftCategoryID != "databases" {
		t.Fatalf("category must be pending: live=%s draft=%q", p.CategoryID, p.DraftCategoryID)
	}

	// reverting to the approved value clears the draft
	back := "network"
	p, err = svc.Update(ctx, owner, p.ID, publications.UpdateInput{CategoryID: &back})
	if err != nil {
		t.Fatalf("revert category: %v", err)
	}
	if p.DraftCategoryID != "" {
		t.Fatalf("revert must clear draft, got %q", p.DraftCategoryID)
	}

	// propose and approve again (without view: only metadata is approved)
	if _, err := svc.Update(ctx, owner, p.ID, publications.UpdateInput{CategoryID: &to}); err != nil {
		t.Fatalf("re-propose: %v", err)
	}
	if _, err := svc.Submit(ctx, owner, p.ID); err != nil {
		t.Fatalf("submit meta-only: %v", err)
	}
	p, err = svc.Approve(ctx, admin(), p.ID)
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	if p.CategoryID != "databases" || p.DraftCategoryID != "" {
		t.Fatalf("category must apply on approve: live=%s draft=%q", p.CategoryID, p.DraftCategoryID)
	}
}

func TestCategoriesRBAC(t *testing.T) {
	ctx := context.Background()
	svc, _ := setup(t)

	if err := svc.CreateCategory(ctx, member("core"), &models.Category{ID: "db", Label: "Базы"}); !errors.Is(err, publications.ErrForbidden) {
		t.Fatalf("member create category: want forbidden, got %v", err)
	}
	if err := svc.CreateCategory(ctx, admin(), &models.Category{ID: "db", Label: "Базы"}); err != nil {
		t.Fatalf("admin create category: %v", err)
	}

	// a referenced category is not deleted
	if _, err := svc.Create(ctx, member("core"), publications.CreateInput{
		ChartProject: "platform", ChartName: "pg", CategoryID: "db", OwnerTeam: "core",
	}); err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteCategory(ctx, admin(), "db"); !errors.Is(err, models.ErrConflict) {
		t.Fatalf("delete referenced category: want conflict, got %v", err)
	}
	if err := svc.DeleteCategory(ctx, admin(), "network"); err != nil {
		t.Fatalf("delete free category: %v", err)
	}
}

func TestAdopt(t *testing.T) {
	ctx := context.Background()
	svc, st := setup(t)
	svc.SetDiscoveryOwner("platform-admins")

	// The discovery reconciler registers an unclaimed draft.
	if err := svc.EnsureDiscovered(ctx, []publications.DiscoveredChart{
		{Project: "platform", Name: "redis", Author: "Maintainer"},
	}, "platform-admins", "network"); err != nil {
		t.Fatalf("discover: %v", err)
	}
	p, err := st.GetPublicationByChart(ctx, "platform", "redis")
	if err != nil {
		t.Fatal(err)
	}

	// A team you are not a member of cannot be the adoption target.
	if _, err := svc.Adopt(ctx, member("core"), p.ID, publications.AdoptInput{
		CategoryID: "network", OwnerTeam: "other",
	}); !errors.Is(err, publications.ErrForbidden) {
		t.Fatalf("foreign team: want forbidden, got %v", err)
	}

	// A member adopts to their own team: owner/category go live, the adopter
	// becomes the publisher.
	p, err = svc.Adopt(ctx, member("core"), p.ID, publications.AdoptInput{
		CategoryID: "network", OwnerTeam: "core",
	})
	if err != nil {
		t.Fatalf("adopt: %v", err)
	}
	if p.OwnerTeam != "core" || p.CategoryID != "network" {
		t.Fatalf("owner/category = %s/%s, want core/network", p.OwnerTeam, p.CategoryID)
	}
	if p.CreatedBy != "u-member" || p.CreatedByName != "Member" {
		t.Fatalf("publisher = %s/%s, want the adopter", p.CreatedBy, p.CreatedByName)
	}

	// Adopted once - cannot be claimed again.
	if _, err := svc.Adopt(ctx, member("core", "other"), p.ID, publications.AdoptInput{
		CategoryID: "network", OwnerTeam: "other",
	}); !errors.Is(err, models.ErrConflict) {
		t.Fatalf("second adopt: want conflict, got %v", err)
	}

	// A manually registered publication is never adoptable.
	manual, err := svc.Create(ctx, member("core"), publications.CreateInput{
		ChartProject: "platform", ChartName: "pg", CategoryID: "network", OwnerTeam: "core",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Adopt(ctx, member("other"), manual.ID, publications.AdoptInput{
		CategoryID: "network", OwnerTeam: "other",
	}); !errors.Is(err, models.ErrConflict) {
		t.Fatalf("adopt manual: want conflict, got %v", err)
	}
}

// TestSeedIdempotent: a fresh installation gets exactly one bootstrap category
// (the system auto-discovery bucket) and no publications; a repeat seed does
// not overwrite admin edits.
func TestSeedIdempotent(t *testing.T) {
	ctx := context.Background()
	st := store.NewMemory()

	if err := store.SeedCategories(ctx, st); err != nil {
		t.Fatalf("seed: %v", err)
	}
	cats, err := st.ListCategories(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(cats) != 1 || cats[0].ID != "uncategorized" {
		t.Fatalf("seed must create only uncategorized, got %+v", cats)
	}
	pubs, err := st.ListPublications(ctx, store.PublicationFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(pubs) != 0 {
		t.Fatalf("seed must create no publications, got %d", len(pubs))
	}

	// a repeat seed does not overwrite edits
	cats[0].Label = "Прочее"
	if err := st.UpdateCategory(ctx, cats[0]); err != nil {
		t.Fatal(err)
	}
	if err := store.SeedCategories(ctx, st); err != nil {
		t.Fatalf("re-seed: %v", err)
	}
	cats2, _ := st.ListCategories(ctx)
	if len(cats2) != 1 || cats2[0].Label != "Прочее" {
		t.Fatalf("re-seed overwrote user edit: %+v", cats2)
	}
}
