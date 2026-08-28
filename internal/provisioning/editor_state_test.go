package provisioning_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"console/internal/provisioning"
	"console/internal/store"
	"console/pkg/models"
)

// TestEditorStateRoundTrip: the opaque editor state survives create and reaches
// the caller unchanged on a single order read.
func TestEditorStateRoundTrip(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")
	state := json.RawMessage(`{"profile":"policies","version":1,"data":{"topology":[]}}`)

	req, err := s.prov.Create(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "pg1", Values: validValues(),
		EditorState: state, Draft: true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	got, err := s.st.GetRequest(ctx, req.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if string(got.EditorState) != string(state) {
		t.Fatalf("editor state not stored: %s", got.EditorState)
	}
}

// TestEditorStateKeptWhenAbsent: a client that sends no editor state (the plain
// form or YAML editor) must not drop the state the graph editor saved earlier.
func TestEditorStateKeptWhenAbsent(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")
	state := json.RawMessage(`{"profile":"policies","version":1,"data":{"topology":[]}}`)

	req, err := s.prov.Create(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "pg1", Values: validValues(),
		EditorState: state, Draft: true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := s.prov.Update(ctx, u, req.ID, provisioning.UpdateInput{Values: validValues()}); err != nil {
		t.Fatalf("update: %v", err)
	}
	got, err := s.st.GetRequest(ctx, req.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if string(got.EditorState) != string(state) {
		t.Fatalf("editor state lost on update without one: %q", got.EditorState)
	}

	// An explicit JSON null is the way to drop it.
	if _, err := s.prov.Update(ctx, u, req.ID, provisioning.UpdateInput{
		Values: validValues(), EditorState: json.RawMessage(`null`),
	}); err != nil {
		t.Fatalf("update (clear): %v", err)
	}
	got, err = s.st.GetRequest(ctx, req.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if string(got.EditorState) != "null" {
		t.Fatalf("editor state not cleared: %q", got.EditorState)
	}
}

// TestEditorStateRejected: oversized or malformed state is a validation error,
// not something we park in the database.
func TestEditorStateRejected(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")

	cases := map[string]json.RawMessage{
		"too large":    json.RawMessage(`{"d":"` + strings.Repeat("x", 256<<10) + `"}`),
		"invalid JSON": json.RawMessage(`{"profile":`),
	}
	for name, state := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := s.prov.Create(ctx, u, provisioning.CreateInput{
				ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
				Team: "core", ServiceName: "pg1", Values: validValues(),
				EditorState: state, Draft: true,
			})
			var verr *provisioning.ValidationError
			if !errors.As(err, &verr) {
				t.Fatalf("want validation error, got %v", err)
			}
		})
	}
}

// TestEditorStateNotInList: lists skip the column, so the orders table stays
// small even when every order carries a canvas.
func TestEditorStateNotInList(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")

	if _, err := s.prov.Create(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "pg1", Values: validValues(),
		EditorState: json.RawMessage(`{"profile":"policies"}`), Draft: true,
	}); err != nil {
		t.Fatalf("create: %v", err)
	}
	reqs, err := s.prov.List(ctx, u, store.RequestFilter{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(reqs) != 1 {
		t.Fatalf("want 1 order, got %d", len(reqs))
	}
	if len(reqs[0].EditorState) != 0 {
		t.Fatalf("list carried the editor state: %s", reqs[0].EditorState)
	}
	if reqs[0].Status != models.StatusDraft {
		t.Fatalf("want DRAFT, got %s", reqs[0].Status)
	}
}

// TestServiceNameConflictExplains: renaming a draft onto a name another active
// order already holds must say so, not surface the unique index's bare
// "conflict". For a chart whose identity comes from the values (the policies
// graph names the order after its first policy) the bare error left the user
// with no idea which field to change.
func TestServiceNameConflictExplains(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")

	if _, err := s.prov.Create(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "taken", DisplayName: "Занятый", Namespace: "apps",
		Values: validValues(), Draft: true,
	}); err != nil {
		t.Fatalf("create first: %v", err)
	}
	other, err := s.prov.Create(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "free", Namespace: "apps", Values: validValues(), Draft: true,
	})
	if err != nil {
		t.Fatalf("create second: %v", err)
	}

	_, err = s.prov.Update(ctx, u, other.ID, provisioning.UpdateInput{
		ServiceName: "taken", Namespace: "apps", Values: validValues(),
	})
	if !errors.Is(err, models.ErrConflict) {
		t.Fatalf("want conflict, got %v", err)
	}
	if err.Error() == "conflict" || !strings.Contains(err.Error(), "taken") {
		t.Fatalf("conflict does not explain itself: %q", err)
	}

	// Creating under a taken name explains itself too.
	_, err = s.prov.Create(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "taken", Namespace: "apps", Values: validValues(), Draft: true,
	})
	if !errors.Is(err, models.ErrConflict) || err.Error() == "conflict" {
		t.Fatalf("create with a taken name: %v", err)
	}
}
