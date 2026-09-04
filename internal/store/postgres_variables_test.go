package store

import (
	"context"
	"errors"
	"os"
	"testing"

	"console/pkg/models"
)

// TestPostgresVariables covers what the in-memory store cannot: the upsert is
// one statement with ON CONFLICT, and the name rule is a CHECK constraint in the
// table rather than Go code. Requires a scratch Postgres: set STORE_TEST_URL,
// e.g.
//
//	STORE_TEST_URL=postgres://portal:portal@localhost:5432/store_vars_test?sslmode=disable
func TestPostgresVariables(t *testing.T) {
	url := os.Getenv("STORE_TEST_URL")
	if url == "" {
		t.Skip("set STORE_TEST_URL to run the Postgres variables test")
	}
	ctx := context.Background()
	pg, err := NewPostgres(ctx, url, 5)
	if err != nil {
		t.Fatalf("NewPostgres: %v", err)
	}
	defer pg.Close()

	v := &models.Variable{Name: "OPS_DOMAIN", Value: "example.com", Description: "Домен", UpdatedBy: "u1"}
	if err := pg.UpsertVariable(ctx, v); err != nil {
		t.Fatalf("insert: %v", err)
	}
	if v.UpdatedAt.IsZero() {
		t.Fatal("insert must return the stored timestamp")
	}
	first := v.UpdatedAt

	// The same name again is an update, not a second row.
	again := &models.Variable{Name: "OPS_DOMAIN", Value: "example.org", UpdatedBy: "u2"}
	if err := pg.UpsertVariable(ctx, again); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	list, err := pg.ListVariables(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 1 || list[0].Value != "example.org" || list[0].UpdatedBy != "u2" {
		t.Fatalf("upsert did not replace the row: %#v", list)
	}
	if !again.UpdatedAt.After(first) && !again.UpdatedAt.Equal(first) {
		t.Fatalf("updated_at went backwards: %v -> %v", first, again.UpdatedAt)
	}

	// The name rule lives in the table too, so a caller that skips the service
	// cannot write a name a document could never reference.
	if err := pg.UpsertVariable(ctx, &models.Variable{Name: "lower-case", Value: "x"}); err == nil {
		t.Fatal("the CHECK constraint must refuse a name in the wrong shape")
	}

	if err := pg.DeleteVariable(ctx, "OPS_DOMAIN"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if err := pg.DeleteVariable(ctx, "OPS_DOMAIN"); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("deleting what is gone must say so, got %v", err)
	}
}
