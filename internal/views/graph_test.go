package views_test

import (
	"testing"

	"console/internal/views"
)

// A policies-shaped schema: the entries list, the rules inside an entry and the
// peers inside a rule. This is what the graph block is checked against.
const policiesSchema = `{
  "type": "object",
  "properties": {
    "policies": {
      "type": "array",
      "items": { "$ref": "#/definitions/policy" }
    },
    "naming": { "type": "object", "properties": { "env": { "type": "string" } } }
  },
  "definitions": {
    "policy": {
      "type": "object",
      "properties": {
        "name": { "type": "string" },
        "enabled": { "type": "boolean" },
        "serviceAccount": { "type": "string" },
        "selector": { "type": "object" },
        "ingress": { "type": "array", "items": { "$ref": "#/definitions/inRule" } },
        "egress": { "type": "array", "items": { "$ref": "#/definitions/outRule" } }
      }
    },
    "inRule": {
      "type": "object",
      "properties": {
        "ports": { "type": "array", "items": { "type": "object" } },
        "from": { "type": "array", "items": { "$ref": "#/definitions/peer" } }
      }
    },
    "outRule": {
      "type": "object",
      "properties": {
        "ports": { "type": "array", "items": { "type": "object" } },
        "to": { "type": "array", "items": { "$ref": "#/definitions/peer" } }
      }
    },
    "peer": {
      "type": "object",
      "properties": {
        "namespace": { "type": "string" },
        "selector": { "type": "object" },
        "serviceAccount": { "type": "string" }
      }
    }
  }
}`

// The order view is required but says nothing here: these tests are about the
// graph block, and an include would have to follow every schema below.
func doc(graph string) string {
	return `{"views": {"order": {"include": []}}, "graph": ` + graph + `}`
}

// A chart that follows the convention needs nothing but the profile name: every
// field defaults to a values key of its own name.
func TestGraphProfileAloneIsEnough(t *testing.T) {
	issues := views.Validate([]byte(doc(`{"profile": "policies"}`)), []byte(policiesSchema))
	if len(issues) > 0 {
		t.Fatalf("want no issues, got %+v", issues)
	}
}

func TestGraphRenamedFields(t *testing.T) {
	// A chart that calls things differently says so, and the block still passes
	// as long as the names it gives exist in the schema.
	schema := `{
      "type": "object",
      "properties": {
        "network": { "type": "array", "items": {
          "type": "object",
          "properties": {
            "title": { "type": "string" },
            "match": { "type": "object" },
            "inbound": { "type": "array", "items": {
              "type": "object",
              "properties": {
                "ports": { "type": "array", "items": { "type": "object" } },
                "from": { "type": "array", "items": {
                  "type": "object",
                  "properties": { "ns": { "type": "string" }, "selector": { "type": "object" } }
                }}
              }
            }}
          }
        }}
      }
    }`
	g := `{
      "profile": "policies",
      "entries": "/network",
      "entry": { "name": "title", "selector": "match", "ingress": "inbound" },
      "peer": { "namespace": "ns" }
    }`
	// egress/serviceAccount/enabled are absent from this schema on purpose: the
	// entry describes its properties, so those are reported and nothing else is.
	issues := views.Validate([]byte(doc(g)), []byte(schema))
	for _, is := range issues {
		switch is.Path {
		case "/graph/entry/egress", "/graph/entry/serviceAccount", "/graph/entry/enabled",
			"/graph/peer/serviceAccount":
		default:
			t.Fatalf("unexpected issue %+v (all issues: %+v)", is, issues)
		}
	}
	if !hasIssue(issues, "/graph/entry/egress", "не найдено") {
		t.Fatalf("want the missing egress field reported, got %+v", issues)
	}
}

func TestGraphStructuralIssues(t *testing.T) {
	cases := []struct {
		name, graph, path, msg string
	}{
		{"not an object", `"policies"`, "/graph", "должен быть объектом"},
		{"no profile", `{"entries": "/policies"}`, "/graph/profile", "Укажите"},
		{"unknown profile", `{"profile": "service-mesh"}`, "/graph/profile", "не существует"},
		{"unknown field", `{"profile": "policies", "colour": "red"}`, "/graph/colour", "Лишнее поле"},
		{"enabled not a bool", `{"profile": "policies", "enabled": "yes"}`, "/graph/enabled", "true или false"},
		{"entries not a pointer", `{"profile": "policies", "entries": "policies"}`, "/graph/entries", "JSON pointer"},
		{"group not an object", `{"profile": "policies", "entry": "name"}`, "/graph/entry", "должен быть объектом"},
		{"field the editor ignores", `{"profile": "policies", "entry": {"colour": "c"}}`, "/graph/entry/colour", "не использует"},
		{"field name with a slash", `{"profile": "policies", "entry": {"name": "a/b"}}`, "/graph/entry/name", "без"},
		{"field name not a string", `{"profile": "policies", "peer": {"namespace": 1}}`, "/graph/peer/namespace", "имя поля"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			issues := views.Validate([]byte(doc(c.graph)), nil)
			if !hasIssue(issues, c.path, c.msg) {
				t.Fatalf("want issue at %s about %q, got %+v", c.path, c.msg, issues)
			}
		})
	}
}

// The point of the whole exercise: a mapping that no longer fits its chart is
// caught while the version is being edited, not by a user mid-order.
func TestGraphSchemaMismatch(t *testing.T) {
	cases := []struct {
		name, graph, path, msg string
	}{
		{
			"entries point nowhere",
			`{"profile": "policies", "entries": "/netpol"}`,
			"/graph/entries", "не находит поле",
		},
		{
			"entries are not a list",
			`{"profile": "policies", "entries": "/naming"}`,
			"/graph/entries", "список записей",
		},
		{
			"an entry field was renamed in the chart",
			`{"profile": "policies", "entry": {"selector": "podSelector"}}`,
			"/graph/entry/selector", "не найдено",
		},
		{
			"a peer field was renamed in the chart",
			`{"profile": "policies", "peer": {"namespace": "ns"}}`,
			"/graph/peer/namespace", "не найдено",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			issues := views.Validate([]byte(doc(c.graph)), []byte(policiesSchema))
			if !hasIssue(issues, c.path, c.msg) {
				t.Fatalf("want issue at %s about %q, got %+v", c.path, c.msg, issues)
			}
		})
	}
}

// A schema that stops describing its shape is not blamed: the rest of this
// package only reports what it can prove wrong, and so does the graph block.
func TestGraphFreeFormSchemaIsNotBlamed(t *testing.T) {
	free := `{"type": "object", "properties": {"policies": {"type": "array", "items": {"type": "object"}}}}`
	issues := views.Validate([]byte(doc(`{"profile": "policies"}`)), []byte(free))
	if len(issues) > 0 {
		t.Fatalf("want no issues for a free-form element, got %+v", issues)
	}
}
