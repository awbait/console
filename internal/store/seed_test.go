package store

import (
	"context"
	"testing"

	"console/pkg/models"
)

// The first start after the upgrade finds orders and no stand: one is made
// from the configured cluster and every order is attached to it. Later starts
// leave the stand as the admin left it.
func TestSeedDefaultStand(t *testing.T) {
	ctx := context.Background()
	m := NewMemory()
	orphan := &models.Request{ID: "r1", Team: "core", ChartName: "postgres", ServiceName: "pg1", Cluster: "in-cluster", Status: models.StatusHealthy}
	if err := m.CreateRequest(ctx, orphan); err != nil {
		t.Fatal(err)
	}

	adopted, err := SeedDefaultStand(ctx, m, "in-cluster", "managed-services")
	if err != nil {
		t.Fatalf("seed: %v", err)
	}
	if adopted != 1 {
		t.Fatalf("adopted %d orders, want 1", adopted)
	}
	def, err := m.DefaultStand(ctx)
	if err != nil {
		t.Fatalf("no default stand after seed: %v", err)
	}
	if def.Name != models.DefaultStandName || def.DefaultCluster != "in-cluster" {
		t.Fatalf("seeded stand: %+v", def)
	}
	if def.Layout != models.LayoutGroup || def.GitPath != "managed-services" {
		t.Fatalf("the seeded stand writes where every order already is: layout=%q path=%q", def.Layout, def.GitPath)
	}
	got, _ := m.GetRequest(ctx, "r1")
	if got.StandID != def.ID {
		t.Fatalf("orphan not attached: stand=%q", got.StandID)
	}

	// The admin renames and re-points the stand; the next start keeps that and
	// does not seed a second one from the configured cluster.
	if err := m.UpdateStand(ctx, &models.Stand{ID: def.ID, Name: "prod", DefaultCluster: "prod-cluster", Layout: models.LayoutGroup, GitPath: "ops/prod"}); err != nil {
		t.Fatal(err)
	}
	if adopted, err := SeedDefaultStand(ctx, m, "in-cluster", "managed-services"); err != nil || adopted != 0 {
		t.Fatalf("second seed: adopted=%d err=%v", adopted, err)
	}
	list, _ := m.ListStands(ctx)
	if len(list) != 1 || list[0].Name != "prod" || list[0].DefaultCluster != "prod-cluster" || list[0].GitPath != "ops/prod" {
		t.Fatalf("stands after second seed: %+v", list)
	}
}

// A stand written by the version before layouts has no path: the next start
// fills it from the configured group, once, and leaves a path that is set.
func TestSeedFillsMissingGitPath(t *testing.T) {
	ctx := context.Background()
	m := NewMemory()
	old := &models.Stand{ID: "s1", Name: "default", DefaultCluster: "in-cluster", Default: true}
	if err := m.CreateStand(ctx, old); err != nil {
		t.Fatal(err)
	}
	if _, err := SeedDefaultStand(ctx, m, "in-cluster", "managed-services"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	def, _ := m.DefaultStand(ctx)
	if def.GitPath != "managed-services" || def.Layout != models.LayoutGroup {
		t.Fatalf("path not filled in: %+v", def)
	}
}
