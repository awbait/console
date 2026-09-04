package views

import (
	"reflect"
	"testing"
)

func TestApplyDefaultsOverwritesAndCreates(t *testing.T) {
	view := []byte(`{"views":{"order":{"identity":"/namespace/namespaceName"}},"defaults":{"/namespace/creator":"console","/top":"x"}}`)

	t.Run("overwrites existing value", func(t *testing.T) {
		values := map[string]any{"namespace": map[string]any{"namespaceName": "demo", "creator": "lk"}}
		out, _, err := ApplyDefaults(values, view, TemplateData{}, nil)
		if err != nil {
			t.Fatalf("ApplyDefaults: %v", err)
		}
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
		out, _, err := ApplyDefaults(map[string]any{}, view, TemplateData{}, nil)
		if err != nil {
			t.Fatalf("ApplyDefaults: %v", err)
		}
		ns, ok := out["namespace"].(map[string]any)
		if !ok || ns["creator"] != "console" {
			t.Fatalf("creator not stamped into fresh map: %#v", out)
		}
	})

	t.Run("nil values map", func(t *testing.T) {
		out, _, err := ApplyDefaults(nil, view, TemplateData{}, nil)
		if err != nil {
			t.Fatalf("ApplyDefaults: %v", err)
		}
		if out == nil {
			t.Fatal("want non-nil map")
		}
	})
}

func TestApplyDefaultsSkipsNonObjectPath(t *testing.T) {
	// /a/b where a is a scalar: must not clobber a, must not panic.
	view := []byte(`{"defaults":{"/a/b":"v"}}`)
	values := map[string]any{"a": "scalar"}
	out, _, err := ApplyDefaults(values, view, TemplateData{}, nil)
	if err != nil {
		t.Fatalf("ApplyDefaults: %v", err)
	}
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

// A pointer through a list writes into the item that is already there. The
// charts of this portal name things inside lists ("/gateways/0/ipAddress"), so
// a defaults block that cannot address them is a defaults block that does
// nothing for most of the catalogue.
func TestApplyDefaultsWritesIntoListItems(t *testing.T) {
	view := []byte(`{"defaults":{"/gateways/0/ipAddress":"10.0.0.1","/gateways/1/ipAddress":"10.0.0.2"}}`)
	values := map[string]any{"gateways": []any{
		map[string]any{"name": "one"},
		map[string]any{"name": "two"},
	}}
	out, skipped, err := ApplyDefaults(values, view, TemplateData{}, nil)
	if err != nil {
		t.Fatalf("ApplyDefaults: %v", err)
	}
	if len(skipped) != 0 {
		t.Fatalf("nothing should have been skipped, got %v", skipped)
	}
	gws := out["gateways"].([]any)
	first := gws[0].(map[string]any)
	if first["ipAddress"] != "10.0.0.1" || first["name"] != "one" {
		t.Fatalf("first gateway = %#v", first)
	}
	if gws[1].(map[string]any)["ipAddress"] != "10.0.0.2" {
		t.Fatalf("second gateway = %#v", gws[1])
	}
}

// What the portal will not do is invent list items: how many gateways an order
// has is the order's business. Such a pointer writes nothing and is reported,
// so the platform can see a document asking for what is not there.
func TestApplyDefaultsReportsWhatItCouldNotWrite(t *testing.T) {
	view := []byte(`{"defaults":{"/gateways/3/ipAddress":"10.0.0.1","/missing/0/x":"v","/a/b":"scalar in the way"}}`)
	values := map[string]any{
		"gateways": []any{map[string]any{"name": "one"}},
		"a":        "already a scalar",
	}
	out, skipped, err := ApplyDefaults(values, view, TemplateData{}, nil)
	if err != nil {
		t.Fatalf("ApplyDefaults: %v", err)
	}
	want := []string{"/a/b", "/gateways/3/ipAddress", "/missing/0/x"}
	if len(skipped) != len(want) {
		t.Fatalf("skipped = %v, want %v", skipped, want)
	}
	for i, ptr := range want {
		if skipped[i] != ptr {
			t.Fatalf("skipped = %v, want %v", skipped, want)
		}
	}
	if out["a"] != "already a scalar" {
		t.Fatalf("a scalar on the way must not be clobbered: %#v", out["a"])
	}
	if _, invented := out["missing"]; invented {
		t.Fatalf("a list was invented: %#v", out["missing"])
	}
}
