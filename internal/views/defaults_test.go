package views

import (
	"reflect"
	"testing"
)

func TestApplyDefaultsOverwritesAndCreates(t *testing.T) {
	view := []byte(`{"views":{"order":{"identity":"/namespace/namespaceName"}},"defaults":{"/namespace/creator":"console","/top":"x"}}`)

	t.Run("overwrites existing value", func(t *testing.T) {
		values := map[string]any{"namespace": map[string]any{"namespaceName": "demo", "creator": "lk"}}
		out := ApplyDefaults(values, view)
		ns := out["namespace"].(map[string]any)
		if ns["creator"] != "console" {
			t.Fatalf("creator = %v, want console", ns["creator"])
		}
		if ns["namespaceName"] != "demo" {
			t.Fatalf("namespaceName must be untouched, got %v", ns["namespaceName"])
		}
		if out["top"] != "x" {
			t.Fatalf("top = %v, want x", out["top"])
		}
	})

	t.Run("creates missing intermediate objects", func(t *testing.T) {
		out := ApplyDefaults(map[string]any{}, view)
		ns, ok := out["namespace"].(map[string]any)
		if !ok || ns["creator"] != "console" {
			t.Fatalf("creator not stamped into fresh map: %#v", out)
		}
	})

	t.Run("nil values map", func(t *testing.T) {
		out := ApplyDefaults(nil, view)
		if out == nil {
			t.Fatal("want non-nil map")
		}
	})
}

func TestApplyDefaultsSkipsNonObjectPath(t *testing.T) {
	// /a/b where a is a scalar: must not clobber a, must not panic.
	view := []byte(`{"defaults":{"/a/b":"v"}}`)
	values := map[string]any{"a": "scalar"}
	out := ApplyDefaults(values, view)
	if out["a"] != "scalar" {
		t.Fatalf("a = %v, want scalar (unchanged)", out["a"])
	}
}

func TestDefaultsParsing(t *testing.T) {
	got := Defaults([]byte(`{"defaults":{"/x":"1"}}`))
	if !reflect.DeepEqual(got, map[string]any{"/x": "1"}) {
		t.Fatalf("Defaults = %#v", got)
	}
	if Defaults([]byte(`{}`)) != nil {
		t.Fatal("absent defaults must be nil")
	}
	if Defaults([]byte(`not json`)) != nil {
		t.Fatal("malformed view must yield nil")
	}
}

func TestValidateDefaults(t *testing.T) {
	// Valid: object of pointer -> scalar (no schema, so no field resolution).
	if issues := ValidateStructure([]byte(`{"views":{"order":{"identity":"/n"}},"defaults":{"/n/creator":"console"}}`)); len(issues) > 0 {
		t.Fatalf("valid defaults flagged: %+v", issues)
	}
	// Key not a pointer.
	if issues := ValidateStructure([]byte(`{"views":{"order":{"identity":"/n"}},"defaults":{"creator":"console"}}`)); len(issues) == 0 {
		t.Fatal("non-pointer key must be flagged")
	}
	// Value not a scalar.
	if issues := ValidateStructure([]byte(`{"views":{"order":{"identity":"/n"}},"defaults":{"/n":{"a":1}}}`)); len(issues) == 0 {
		t.Fatal("object value must be flagged")
	}
	// Block not an object.
	if issues := ValidateStructure([]byte(`{"views":{"order":{"identity":"/n"}},"defaults":[]}`)); len(issues) == 0 {
		t.Fatal("non-object defaults block must be flagged")
	}
}
