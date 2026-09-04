package views

import (
	"strings"
	"testing"
)

// A chart with one field of each type the conversion cares about.
var typedSchema = []byte(`{
  "type": "object",
  "properties": {
    "primary": {
      "type": "object",
      "properties": {
        "replicas": {"type": "integer"},
        "ratio": {"type": "number"},
        "enabled": {"type": "boolean"},
        "name": {"type": "string"}
      }
    }
  }
}`)

// A template renders text, and a chart field is not always text. The value is
// converted to what the field declares, so a port stamped from a variable
// arrives as a number instead of breaking the chart's own schema check.
func TestApplyDefaultsConvertsToFieldType(t *testing.T) {
	view := []byte(`{"defaults":{
		"/primary/replicas":"{{.Vars.REPLICAS}}",
		"/primary/ratio":"1.5",
		"/primary/enabled":"true",
		"/primary/name":"{{.Team}}"}}`)
	data := sampleData()
	data.Vars = map[string]string{"REPLICAS": "3"}

	out, _, err := ApplyDefaults(map[string]any{}, view, data, typedSchema)
	if err != nil {
		t.Fatalf("ApplyDefaults: %v", err)
	}
	primary := out["primary"].(map[string]any)
	if primary["replicas"] != int64(3) {
		t.Fatalf("replicas = %#v, want int64(3)", primary["replicas"])
	}
	if primary["ratio"] != 1.5 {
		t.Fatalf("ratio = %#v, want 1.5", primary["ratio"])
	}
	if primary["enabled"] != true {
		t.Fatalf("enabled = %#v, want true", primary["enabled"])
	}
	if primary["name"] != "payments" {
		t.Fatalf("name = %#v, want the team as text", primary["name"])
	}
}

// A variable holding text, written into a number: the order is refused before
// anything is saved, and the refusal names the field and what it takes. The
// chart's own schema would refuse it too, but as a complaint about a field the
// person filling the form never touched.
func TestApplyDefaultsRefusesValueOfTheWrongType(t *testing.T) {
	view := []byte(`{"defaults":{"/primary/replicas":"{{.Vars.REPLICAS}}"}}`)
	data := sampleData()
	data.Vars = map[string]string{"REPLICAS": "abc"}

	_, _, err := ApplyDefaults(map[string]any{}, view, data, typedSchema)
	if err == nil {
		t.Fatal("text in a number field must be refused")
	}
	for _, want := range []string{"/primary/replicas", "целое число", "abc"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("error %q does not mention %q", err, want)
		}
	}
}

// Without the chart schema nothing is converted: the portal writes what the
// document says and the chart has the last word, exactly as before.
func TestApplyDefaultsWithoutSchemaKeepsText(t *testing.T) {
	view := []byte(`{"defaults":{"/primary/replicas":"3"}}`)
	out, _, err := ApplyDefaults(map[string]any{}, view, sampleData(), nil)
	if err != nil {
		t.Fatalf("ApplyDefaults: %v", err)
	}
	if out["primary"].(map[string]any)["replicas"] != "3" {
		t.Fatalf("value must stay as written: %#v", out)
	}
}

func TestRenderInitialConvertsToFieldType(t *testing.T) {
	view := []byte(`{"initial":{"/primary/replicas":"{{.Vars.REPLICAS}}"}}`)
	data := sampleData()
	data.Vars = map[string]string{"REPLICAS": "2"}

	out, err := RenderInitial(view, data, typedSchema)
	if err != nil {
		t.Fatalf("RenderInitial: %v", err)
	}
	if out["primary"].(map[string]any)["replicas"] != int64(2) {
		t.Fatalf("the form must be seeded with a number: %#v", out)
	}
}

// The same rule where the document is written. What the constructor can prove,
// it says; what it cannot, it leaves alone rather than complaining about a
// document that would work.
func TestConstructorChecksValueTypes(t *testing.T) {
	vars := map[string]string{"PORT": "8080", "NAME": "abc"}
	cases := []struct {
		name, value string
		wantIssue   string // "" means the document must pass
	}{
		{"literal number as text", "3", ""},
		{"literal text", "abc", "целое число"},
		{"variable holding a number", "{{.Vars.PORT}}", ""},
		{"variable holding text", "{{.Vars.NAME}}", "«NAME» сейчас равна"},
		{"reference that is always text", "{{.Team}}", "даёт текст"},
		{"reference inside text", "port-{{.Vars.PORT}}", "всегда получается текст"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			doc := []byte(`{"views":{"order":{}},"defaults":{"/primary/replicas":` + quote(c.value) + `}}`)
			issues := Validate(doc, typedSchema, WithVariables(vars))
			if c.wantIssue == "" {
				if len(issues) > 0 {
					t.Fatalf("valid document flagged: %+v", issues)
				}
				return
			}
			if len(issues) == 0 {
				t.Fatalf("%q must be flagged", c.value)
			}
			if !strings.Contains(issues[0].Message, c.wantIssue) {
				t.Fatalf("issue %q does not mention %q", issues[0].Message, c.wantIssue)
			}
			if issues[0].Path != "/defaults/primary/replicas" {
				t.Fatalf("issue path = %q", issues[0].Path)
			}
		})
	}
}

// A variable whose value the checker does not have is not judged: the list may
// simply be unreadable, and the stamp says it at order time anyway.
func TestConstructorLeavesUnknownVariableTypeAlone(t *testing.T) {
	doc := []byte(`{"views":{"order":{}},"defaults":{"/primary/replicas":"{{.Vars.PORT}}"}}`)
	if issues := Validate(doc, typedSchema); len(issues) > 0 {
		t.Fatalf("without a variable list nothing should be said: %+v", issues)
	}
}

func quote(s string) string { return `"` + s + `"` }
