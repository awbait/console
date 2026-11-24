package provisioning_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"console/internal/provisioning"
	"console/internal/store"
	"console/pkg/models"
)

func TestUpdateRejectsImmutableFields(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")

	view := []byte(`{
		"views": {
			"order": {
				"identity": "/auth/database",
				"overrides": {
					"auth/username": {"ui:readOnly": true}
				}
			}
		}
	}`)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", view)

	created, err := s.prov.Create(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "pg1",
		Values: map[string]any{
			"auth":    map[string]any{"database": "app", "username": "appuser"},
			"primary": map[string]any{"replicas": 1},
		},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	s.mergeLatestMR(ctx, t, created.ID)
	s.tick(ctx)

	// Changing identity (/auth/database) is rejected.
	_, err = s.prov.Update(ctx, u, created.ID, provisioning.UpdateInput{
		Values: map[string]any{
			"auth":    map[string]any{"database": "other", "username": "appuser"},
			"primary": map[string]any{"replicas": 1},
		},
	})
	var ve *provisioning.ValidationError
	if !errors.As(err, &ve) || !strings.Contains(ve.Message, "auth.database") {
		t.Fatalf("identity edit: want validation error naming auth.database, got %v", err)
	}

	// Changing ui:readOnly (/auth/username) is rejected even for admin.
	_, err = s.prov.Update(ctx, admin(), created.ID, provisioning.UpdateInput{
		Values: map[string]any{
			"auth":    map[string]any{"database": "app", "username": "hacker"},
			"primary": map[string]any{"replicas": 1},
		},
	})
	if !errors.As(err, &ve) || !strings.Contains(ve.Message, "auth.username") {
		t.Fatalf("readOnly edit: want validation error naming auth.username, got %v", err)
	}

	// Editing a mutable field (primary.replicas) succeeds.
	updated, err := s.prov.Update(ctx, u, created.ID, provisioning.UpdateInput{
		Values: map[string]any{
			"auth":    map[string]any{"database": "app", "username": "appuser"},
			"primary": map[string]any{"replicas": 3},
		},
	})
	if err != nil {
		t.Fatalf("mutable edit: %v", err)
	}
	if !strings.Contains(updated.ValuesYAML, "replicas: 3") {
		t.Fatalf("expected updated replicas in yaml:\n%s", updated.ValuesYAML)
	}
}

func TestValidateUpdateDryRun(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")

	view := []byte(`{
		"views": {
			"order": {
				"identity": "/auth/database"
			}
		},
		"defaults": {
			"/auth/creator": "console"
		}
	}`)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", view)

	live := liveOrder(ctx, t, s)
	mrsBefore, _ := s.st.ListMRs(ctx, live.ID)

	// Valid change reports changed=true and returns stamped YAML, without opening an MR.
	res, err := s.prov.ValidateUpdate(ctx, u, live.ID, provisioning.UpdateInput{
		Values: map[string]any{
			"auth":    map[string]any{"database": "app", "creator": "manual"},
			"primary": map[string]any{"replicas": 2},
		},
	})
	if err != nil {
		t.Fatalf("validate valid change: %v", err)
	}
	if !res.Changed {
		t.Fatal("want changed=true")
	}
	if !strings.Contains(res.ValuesYAML, "creator: console") || !strings.Contains(res.ValuesYAML, "replicas: 2") {
		t.Fatalf("unexpected validated yaml:\n%s", res.ValuesYAML)
	}
	mrsAfter, _ := s.st.ListMRs(ctx, live.ID)
	if len(mrsAfter) != len(mrsBefore) {
		t.Fatalf("dry run must not open MRs: before=%d after=%d", len(mrsBefore), len(mrsAfter))
	}

	// Identical values report changed=false.
	same, err := s.prov.ValidateUpdate(ctx, u, live.ID, provisioning.UpdateInput{
		Values: map[string]any{"auth": map[string]any{"database": "app"}},
	})
	if err != nil {
		t.Fatalf("validate unchanged: %v", err)
	}
	if same.Changed {
		t.Fatalf("want changed=false for identical values, got yaml:\n%s", same.ValuesYAML)
	}

	// Schema violation returns structured FieldErrors.
	_, err = s.prov.ValidateUpdate(ctx, u, live.ID, provisioning.UpdateInput{
		Values: map[string]any{
			"auth":    map[string]any{"database": "app"},
			"primary": map[string]any{"replicas": "not-a-number"},
		},
	})
	var ve *provisioning.ValidationError
	if !errors.As(err, &ve) || len(ve.Fields) == 0 || ve.Fields[0].Path != "/primary/replicas" {
		t.Fatalf("want field error for /primary/replicas, got %v", err)
	}

	// Immutable field violation is caught in dry run too.
	_, err = s.prov.ValidateUpdate(ctx, u, live.ID, provisioning.UpdateInput{
		Values: map[string]any{"auth": map[string]any{"database": "renamed"}},
	})
	if !errors.As(err, &ve) || !strings.Contains(ve.Message, "auth.database") {
		t.Fatalf("want immutable error for auth.database, got %v", err)
	}

	// Another team cannot validate this order.
	_, err = s.prov.ValidateUpdate(ctx, member("other"), live.ID, provisioning.UpdateInput{
		Values: map[string]any{"auth": map[string]any{"database": "app"}},
	})
	if !errors.Is(err, provisioning.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}

	// Drafts cannot use live ValidateUpdate.
	dr, err := s.prov.Create(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "pg-draft", Values: validValues(), Draft: true,
	})
	if err != nil {
		t.Fatalf("create draft: %v", err)
	}
	if dr.Status != models.StatusDraft {
		t.Fatalf("want DRAFT, got %s", dr.Status)
	}
	if _, err := s.prov.ValidateUpdate(ctx, u, dr.ID, provisioning.UpdateInput{Values: validValues()}); !errors.As(err, &ve) {
		t.Fatalf("draft validate: want validation error, got %v", err)
	}
}

func TestValidateCreateDryRun(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")

	view := []byte(`{
		"views": {
			"order": {
				"identity": "/auth/database"
			}
		},
		"defaults": {
			"/auth/creator": "console"
		}
	}`)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", view)

	// Valid new order returns stamped YAML without persisting anything.
	res, err := s.prov.ValidateCreate(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "pg-new",
		Values: map[string]any{
			"auth":    map[string]any{"database": "app"},
			"primary": map[string]any{"replicas": 2},
		},
	})
	if err != nil {
		t.Fatalf("validate valid create: %v", err)
	}
	if !strings.Contains(res.ValuesYAML, "creator: console") || !strings.Contains(res.ValuesYAML, "replicas: 2") {
		t.Fatalf("unexpected validated yaml:\n%s", res.ValuesYAML)
	}
	reqs, _ := s.prov.List(ctx, u, store.RequestFilter{})
	if len(reqs) != 0 {
		t.Fatalf("dry run must not persist order: got %d orders", len(reqs))
	}

	// Schema violation returns structured FieldErrors.
	_, err = s.prov.ValidateCreate(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "pg-bad",
		Values: map[string]any{
			"auth":    map[string]any{"database": "app"},
			"primary": map[string]any{"replicas": "not-a-number"},
		},
	})
	var ve *provisioning.ValidationError
	if !errors.As(err, &ve) || len(ve.Fields) == 0 || ve.Fields[0].Path != "/primary/replicas" {
		t.Fatalf("want field error for /primary/replicas, got %v", err)
	}

	// Another team cannot validate a create for core.
	_, err = s.prov.ValidateCreate(ctx, member("other"), provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "pg-forbidden",
		Values: validValues(),
	})
	if !errors.Is(err, provisioning.ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
}
