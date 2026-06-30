package store

import (
	"context"
	"errors"
	"testing"

	"console/pkg/models"
)

func newTestPub(id string) *models.ChartPublication {
	return &models.ChartPublication{
		ID:           id,
		ChartProject: "library",
		ChartName:    "ingress",
		CategoryID:   "uncategorized",
		OwnerTeam:    "platform",
		CreatedBy:    "alice",
		Status:       models.PubDraft,
	}
}

func TestMemoryVersionUpsertAndGet(t *testing.T) {
	ctx := context.Background()
	m := NewMemory()
	if err := m.CreateCategory(ctx, &models.Category{ID: "uncategorized", Label: "x"}); err != nil {
		t.Fatal(err)
	}
	pub := newTestPub("pub-1")
	if err := m.CreatePublication(ctx, pub); err != nil {
		t.Fatal(err)
	}

	v := &models.PublicationVersion{
		ID:            "ver-1",
		PublicationID: pub.ID,
		ChartVersion:  "1.0.0",
		ViewJSON:      []byte(`{"a":1}`),
		Status:        models.PubDraft,
	}
	if err := m.UpsertVersion(ctx, v); err != nil {
		t.Fatal(err)
	}
	if v.Version != 1 {
		t.Fatalf("new version want 1, got %d", v.Version)
	}

	// Upsert on the same (publication_id, chart_version) updates in place and bumps version.
	upd := &models.PublicationVersion{
		ID:            "ignored-id", // keyed by (pub, chart_version), not ID
		PublicationID: pub.ID,
		ChartVersion:  "1.0.0",
		Status:        models.PubApproved,
		Orderable:     true,
	}
	if err := m.UpsertVersion(ctx, upd); err != nil {
		t.Fatal(err)
	}
	if upd.ID != "ver-1" {
		t.Fatalf("upsert should keep original ID, got %q", upd.ID)
	}
	if upd.Version != 2 {
		t.Fatalf("updated version want 2, got %d", upd.Version)
	}

	got, err := m.GetVersion(ctx, pub.ID, "1.0.0")
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != models.PubApproved || !got.Orderable {
		t.Fatalf("unexpected stored version: %+v", got)
	}

	if _, err := m.GetVersion(ctx, pub.ID, "9.9.9"); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("missing version want ErrNotFound, got %v", err)
	}
}

func TestMemoryVersionListOrdered(t *testing.T) {
	ctx := context.Background()
	m := NewMemory()
	for i, cv := range []string{"1.0.0", "2.0.0", "1.5.0"} {
		v := &models.PublicationVersion{
			ID:            "ver-" + cv,
			PublicationID: "pub-1",
			ChartVersion:  cv,
			Status:        models.PubDraft,
		}
		if err := m.UpsertVersion(ctx, v); err != nil {
			t.Fatalf("upsert %d: %v", i, err)
		}
	}
	list, err := m.ListVersions(ctx, "pub-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 3 {
		t.Fatalf("want 3 versions, got %d", len(list))
	}
	// stamp() is strictly increasing, so insertion order is preserved.
	want := []string{"1.0.0", "2.0.0", "1.5.0"}
	for i, v := range list {
		if v.ChartVersion != want[i] {
			t.Fatalf("order[%d] want %s, got %s", i, want[i], v.ChartVersion)
		}
	}
}

func TestMemorySetOrderableAndRecommended(t *testing.T) {
	ctx := context.Background()
	m := NewMemory()
	if err := m.CreateCategory(ctx, &models.Category{ID: "uncategorized", Label: "x"}); err != nil {
		t.Fatal(err)
	}
	pub := newTestPub("pub-1")
	if err := m.CreatePublication(ctx, pub); err != nil {
		t.Fatal(err)
	}
	v := &models.PublicationVersion{ID: "ver-1", PublicationID: pub.ID, ChartVersion: "1.0.0", Status: models.PubApproved}
	if err := m.UpsertVersion(ctx, v); err != nil {
		t.Fatal(err)
	}

	if err := m.SetOrderable(ctx, "ver-1", true); err != nil {
		t.Fatal(err)
	}
	got, _ := m.GetVersion(ctx, pub.ID, "1.0.0")
	if !got.Orderable {
		t.Fatal("SetOrderable did not stick")
	}
	if err := m.SetOrderable(ctx, "missing", true); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("SetOrderable missing want ErrNotFound, got %v", err)
	}

	if err := m.SetRecommended(ctx, pub.ID, "1.0.0"); err != nil {
		t.Fatal(err)
	}
	gp, _ := m.GetPublication(ctx, pub.ID)
	if gp.RecommendedVersion != "1.0.0" {
		t.Fatalf("recommended want 1.0.0, got %q", gp.RecommendedVersion)
	}
	if err := m.SetRecommended(ctx, "missing", "1.0.0"); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("SetRecommended missing want ErrNotFound, got %v", err)
	}
}
