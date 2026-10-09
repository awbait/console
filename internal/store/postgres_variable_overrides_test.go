package store

import (
	"context"
	"errors"
	"os"
	"testing"

	"console/pkg/models"
)

// TestPostgresVariableOverrides covers what only the database decides: the
// foreign keys that turn an unknown stand or variable into ErrNotFound, the
// cascade that takes the overrides with the variable, and the order the list
// returns them in. Requires a scratch Postgres: set STORE_TEST_URL.
func TestPostgresVariableOverrides(t *testing.T) {
	url := os.Getenv("STORE_TEST_URL")
	if url == "" {
		t.Skip("set STORE_TEST_URL to run the Postgres variable overrides test")
	}
	ctx := context.Background()
	pg, err := NewPostgres(ctx, url, 5)
	if err != nil {
		t.Fatalf("NewPostgres: %v", err)
	}
	defer pg.Close()
	stands := []*models.Stand{
		{ID: "11111111-1111-1111-1111-111111111111", Name: "ovr-zeta", DefaultCluster: "z"},
		{ID: "22222222-2222-2222-2222-222222222222", Name: "ovr-alpha", DefaultCluster: "a"},
		{ID: "33333333-3333-3333-3333-333333333333", Name: "ovr-mid", DefaultCluster: "m"},
	}
	// Only this test's rows are cleaned: the scratch database is shared with
	// the other Postgres tests, and a request keeps its stand and its events.
	if _, err := pg.db.Exec(ctx, `DELETE FROM variables WHERE name = 'OPS_DOMAIN'`); err != nil {
		t.Fatalf("clean variables: %v", err)
	}
	if _, err := pg.db.Exec(ctx, `DELETE FROM stands WHERE name LIKE 'ovr-%' OR id IN ($1,$2,$3)`,
		stands[0].ID, stands[1].ID, stands[2].ID); err != nil {
		t.Fatalf("clean stands: %v", err)
	}
	for _, s := range stands {
		if err := pg.CreateStand(ctx, s); err != nil {
			t.Fatalf("create stand %s: %v", s.Name, err)
		}
	}
	v := &models.Variable{Name: "OPS_DOMAIN", Value: "shared"}
	if err := pg.UpsertVariable(ctx, v); err != nil {
		t.Fatalf("variable: %v", err)
	}

	if err := pg.SetVariableOverride(ctx, "NOPE", &models.VariableOverride{StandID: stands[0].ID, Value: "x"}); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("unknown variable: want ErrNotFound, got %v", err)
	}
	if err := pg.SetVariableOverride(ctx, "OPS_DOMAIN", &models.VariableOverride{StandID: "44444444-4444-4444-4444-444444444444", Value: "x"}); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("unknown stand: want ErrNotFound, got %v", err)
	}
	for _, s := range stands {
		o := &models.VariableOverride{StandID: s.ID, Value: "on-" + s.Name, UpdatedBy: "u1"}
		if err := pg.SetVariableOverride(ctx, "OPS_DOMAIN", o); err != nil {
			t.Fatalf("override %s: %v", s.Name, err)
		}
		if o.UpdatedAt.IsZero() {
			t.Fatal("the stored timestamp comes back")
		}
	}
	// The same stand again replaces, it does not add.
	if err := pg.SetVariableOverride(ctx, "OPS_DOMAIN", &models.VariableOverride{StandID: stands[0].ID, Value: "again", UpdatedBy: "u2"}); err != nil {
		t.Fatalf("replace: %v", err)
	}

	list, err := pg.ListVariables(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 1 || len(list[0].Overrides) != 3 {
		t.Fatalf("want one variable with three overrides: %#v", list)
	}
	// By stand name, the order the stands page uses (none of these is the
	// default stand: the scratch database may already have one).
	got := []string{list[0].Overrides[0].Value, list[0].Overrides[1].Value, list[0].Overrides[2].Value}
	if got[0] != "on-ovr-alpha" || got[1] != "on-ovr-mid" || got[2] != "again" {
		t.Fatalf("override order: %v", got)
	}
	if list[0].Overrides[2].UpdatedBy != "u2" {
		t.Fatalf("replace did not update the row: %+v", list[0].Overrides[2])
	}

	if err := pg.DeleteVariableOverride(ctx, "OPS_DOMAIN", stands[1].ID); err != nil {
		t.Fatalf("delete override: %v", err)
	}
	if err := pg.DeleteVariableOverride(ctx, "OPS_DOMAIN", stands[1].ID); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("delete twice: want ErrNotFound, got %v", err)
	}
	if err := pg.DeleteVariable(ctx, "OPS_DOMAIN"); err != nil {
		t.Fatalf("delete variable: %v", err)
	}
	var left int
	if err := pg.db.QueryRow(ctx, `SELECT count(*) FROM variable_overrides`).Scan(&left); err != nil {
		t.Fatalf("count: %v", err)
	}
	if left != 0 {
		t.Fatalf("deleting the variable must take its overrides along, %d left", left)
	}
}
