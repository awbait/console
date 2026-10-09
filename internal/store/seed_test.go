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

	adopted, err := SeedDefaultStand(ctx, m, "in-cluster")
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
	got, _ := m.GetRequest(ctx, "r1")
	if got.StandID != def.ID {
		t.Fatalf("orphan not attached: stand=%q", got.StandID)
	}

	// The admin renames and re-points the stand; the next start keeps that and
	// does not seed a second one from the configured cluster.
	if err := m.UpdateStand(ctx, &models.Stand{ID: def.ID, Name: "prod", DefaultCluster: "prod-cluster"}); err != nil {
		t.Fatal(err)
	}
	if adopted, err := SeedDefaultStand(ctx, m, "in-cluster"); err != nil || adopted != 0 {
		t.Fatalf("second seed: adopted=%d err=%v", adopted, err)
	}
	list, _ := m.ListStands(ctx)
	if len(list) != 1 || list[0].Name != "prod" || list[0].DefaultCluster != "prod-cluster" {
		t.Fatalf("stands after second seed: %+v", list)
	}
}
