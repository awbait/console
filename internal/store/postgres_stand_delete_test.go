package store

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"console/pkg/models"
	"github.com/google/uuid"
)

// A deleted stand leaves the lists but stays readable, frees its name,
// takes its variable values with it, and the default stand is never deleted.
// Needs a scratch Postgres: set STORE_TEST_URL.
func TestPostgresDeleteStand(t *testing.T) {
	url := os.Getenv("STORE_TEST_URL")
	if url == "" {
		t.Skip("set STORE_TEST_URL to run the Postgres stand deletion test")
	}
	ctx := context.Background()
	pg, err := NewPostgres(ctx, url, 5)
	if err != nil {
		t.Fatalf("NewPostgres: %v", err)
	}
	defer pg.Close()

	name := "del-" + uuid.NewString()[:8]
	st := &models.Stand{ID: uuid.NewString(), Name: name, DefaultCluster: "in-cluster", GitPath: "managed-services/del"}
	if err := pg.CreateStand(ctx, st); err != nil {
		t.Fatalf("create stand: %v", err)
	}
	defer func() { _, _ = pg.pool.Exec(ctx, `DELETE FROM stands WHERE name = $1`, name) }()
	varName := "DEL_" + strings.ToUpper(strings.ReplaceAll(uuid.NewString()[:8], "-", ""))
	if err := pg.UpsertVariable(ctx, &models.Variable{Name: varName, Value: "x"}); err != nil {
		t.Fatalf("variable: %v", err)
	}
	defer func() { _ = pg.DeleteVariable(ctx, varName) }()
	if err := pg.SetVariableOverride(ctx, varName, &models.VariableOverride{StandID: st.ID, Value: "y", UpdatedBy: "adm"}); err != nil {
		t.Fatalf("override: %v", err)
	}
	if err := pg.MarkStandStorageCreated(ctx, st.ID); err != nil {
		t.Fatalf("mark: %v", err)
	}

	if err := pg.DeleteStand(ctx, st.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	got, err := pg.GetStand(ctx, st.ID)
	if err != nil || got.DeletedAt == nil || !got.StorageCreated {
		t.Fatalf("a deleted stand is still readable: %+v %v", got, err)
	}
	list, _ := pg.ListStands(ctx)
	for _, s := range list {
		if s.ID == st.ID {
			t.Fatal("a deleted stand is not listed")
		}
	}
	var overrides int
	_ = pg.pool.QueryRow(ctx, `SELECT count(*) FROM variable_overrides WHERE stand_id = $1`, st.ID).Scan(&overrides)
	if overrides != 0 {
		t.Fatalf("the stand's variable values are gone: %d left", overrides)
	}
	if err := pg.DeleteStand(ctx, st.ID); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("deleting twice: want ErrNotFound, got %v", err)
	}
	again := &models.Stand{ID: uuid.NewString(), Name: name, DefaultCluster: "in-cluster", GitPath: "managed-services/del"}
	if err := pg.CreateStand(ctx, again); err != nil {
		t.Fatalf("the name is free again: %v", err)
	}
	if err := pg.CreateStand(ctx, &models.Stand{ID: uuid.NewString(), Name: name, DefaultCluster: "in-cluster"}); !errors.Is(err, models.ErrConflict) {
		t.Fatalf("but only once among live stands: %v", err)
	}

	if def, err := pg.DefaultStand(ctx); err == nil {
		if err := pg.DeleteStand(ctx, def.ID); !errors.Is(err, models.ErrNotFound) {
			t.Fatalf("the default stand is never deleted: %v", err)
		}
	}
}
