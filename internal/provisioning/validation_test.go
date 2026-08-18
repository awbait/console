package provisioning_test

import (
	"context"
	"errors"
	"testing"

	"console/internal/provisioning"
)

// The portal words a validation failure itself, in the same sentence the field's
// own hint uses. For that it needs to know which rule the value broke, not just
// what the validator had to say about it in English.
func TestSchemaValidationNamesTheBrokenRule(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")

	order := func(values map[string]any) []provisioning.FieldError {
		t.Helper()
		_, err := s.prov.Create(ctx, u, provisioning.CreateInput{
			ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
			Team: "core", ServiceName: "pg1", Values: values,
		})
		var ve *provisioning.ValidationError
		if !errors.As(err, &ve) {
			t.Fatalf("want validation error, got %v", err)
		}
		return ve.Fields
	}

	t.Run("a missing property is pinned to the field, not to the object above it", func(t *testing.T) {
		fields := order(map[string]any{"auth": map[string]any{}})
		if len(fields) != 1 {
			t.Fatalf("want one field error, got %+v", fields)
		}
		if fields[0].Path != "/auth/database" || fields[0].Keyword != "required" {
			t.Fatalf("got path=%q keyword=%q", fields[0].Path, fields[0].Keyword)
		}
	})

	t.Run("a missing top-level property is pinned to itself as well", func(t *testing.T) {
		fields := order(map[string]any{})
		if len(fields) != 1 || fields[0].Path != "/auth" || fields[0].Keyword != "required" {
			t.Fatalf("got %+v", fields)
		}
	})

	t.Run("a value of the wrong type names the rule it broke", func(t *testing.T) {
		fields := order(map[string]any{"auth": map[string]any{"database": 5}})
		if len(fields) != 1 {
			t.Fatalf("want one field error, got %+v", fields)
		}
		if fields[0].Path != "/auth/database" || fields[0].Keyword != "type" {
			t.Fatalf("got path=%q keyword=%q", fields[0].Path, fields[0].Keyword)
		}
	})
}
