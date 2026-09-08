package catalog

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"github.com/santhosh-tekuri/jsonschema/v5"

	"console/pkg/models"
)

func decode(t *testing.T, b []byte) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("effective schema is not JSON: %v", err)
	}
	return m
}

func propertyOf(t *testing.T, schema map[string]any, key string) map[string]any {
	t.Helper()
	props, _ := schema["properties"].(map[string]any)
	node, ok := props[key].(map[string]any)
	if !ok {
		t.Fatalf("property %q is not in the effective schema (has %v)", key, keysOf(props))
	}
	return node
}

func keysOf(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// The whole point of the effective schema: a dependency's field becomes an
// ordinary path into the order's values, so nothing downstream has to know that
// dependencies exist.
func TestMountDependenciesMountsUnderTheValuesKey(t *testing.T) {
	parent := []byte(`{"type":"object","properties":{"auth":{"type":"object"}}}`)
	deps := []models.ChartDependency{{
		Name: "pgbouncer", Alias: "pooler", Key: "pooler",
		Schema: []byte(`{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"poolMode":{"type":"string"},"global":{"type":"object"}}}`),
	}}

	out, deps := mountDependencies(parent, deps)
	schema := decode(t, out)
	if _, ok := schema["properties"].(map[string]any)["auth"]; !ok {
		t.Error("the chart's own fields did not survive mounting")
	}
	pooler := propertyOf(t, schema, "pooler")
	if pooler[models.SchemaDependencyAnnotation] != "pgbouncer" {
		t.Errorf("annotation = %v, want the dependency's chart name", pooler[models.SchemaDependencyAnnotation])
	}
	props, _ := pooler["properties"].(map[string]any)
	if _, ok := props["poolMode"]; !ok {
		t.Error("the dependency's own field is missing")
	}
	// "global" is read by Helm from the root of the parent's values, never from
	// under the subchart key, so a mounted one would offer a dead field.
	if _, ok := props["global"]; ok {
		t.Error("global was mounted under the dependency key")
	}
	if _, ok := pooler["$schema"]; ok {
		t.Error("the dependency's $schema was carried into the parent document")
	}
	if deps[0].Warning != "" {
		t.Errorf("unexpected warning: %s", deps[0].Warning)
	}
}

// A subchart's "#/definitions/..." references mean its own definitions. Mounted
// as they stand they would resolve against the parent, silently picking up a
// same-named definition or nothing at all.
func TestMountDependenciesRepointsLocalRefs(t *testing.T) {
	parent := []byte(`{"type":"object","properties":{},"definitions":{"size":{"type":"integer"}}}`)
	deps := []models.ChartDependency{{
		Name: "pgbouncer", Key: "pooler",
		Schema: []byte(`{
		  "type":"object",
		  "properties":{"limits":{"$ref":"#/definitions/size"}},
		  "definitions":{"size":{"type":"string","enum":["small","large"]}}
		}`),
	}}

	out, _ := mountDependencies(parent, deps)
	schema := decode(t, out)
	pooler := propertyOf(t, schema, "pooler")
	limits, _ := pooler["properties"].(map[string]any)["limits"].(map[string]any)
	ref, _ := limits["$ref"].(string)
	if !strings.HasPrefix(ref, "#/definitions/dependency:pooler/") {
		t.Fatalf("$ref = %q, still points into the parent's definitions", ref)
	}
	// And the target it now names has to be there.
	node := any(schema)
	for seg := range strings.SplitSeq(strings.TrimPrefix(ref, "#/"), "/") {
		m, ok := node.(map[string]any)
		if !ok {
			t.Fatalf("$ref %q does not resolve (stopped at %q)", ref, seg)
		}
		node = m[seg]
	}
	target, _ := node.(map[string]any)
	if target["type"] != "string" {
		t.Errorf("$ref resolved to %v, want the dependency's own definition", node)
	}
	if _, ok := schema["definitions"].(map[string]any)["size"]; !ok {
		t.Error("the parent's own definitions were lost")
	}
}

// Helm checks the whole coalesced values against the parent's schema, subchart
// keys included. A parent that forbids unknown keys and never mentions the
// dependency is a chart that cannot be installed, and the person who can fix it
// is looking at the constructor right now.
func TestMountDependenciesWarnsOnStrictParent(t *testing.T) {
	parent := []byte(`{"type":"object","additionalProperties":false,"properties":{"auth":{"type":"object"}}}`)
	deps := []models.ChartDependency{{Name: "pgbouncer", Key: "pooler", Schema: []byte(`{"type":"object"}`)}}

	_, deps = mountDependencies(parent, deps)
	if !strings.Contains(deps[0].Warning, "additionalProperties") {
		t.Errorf("warning = %q", deps[0].Warning)
	}
}

// A parent describing the subchart's values itself is the chart's own decision
// and wins. Saying so is the only way to explain why the dependency's tab shows
// fields the form does not.
func TestMountDependenciesLeavesDeclaredKeyAlone(t *testing.T) {
	parent := []byte(`{"type":"object","properties":{"pooler":{"type":"object","properties":{"enabled":{"type":"boolean"}}}}}`)
	deps := []models.ChartDependency{{
		Name: "pgbouncer", Key: "pooler",
		Schema: []byte(`{"type":"object","properties":{"poolMode":{"type":"string"}}}`),
	}}

	out, deps := mountDependencies(parent, deps)
	if string(out) != string(parent) {
		t.Errorf("effective schema = %s, want the parent untouched", out)
	}
	if deps[0].Warning == "" {
		t.Error("no warning about the chart describing the dependency itself")
	}
}

// A chart with no values.schema.json of its own still has a form when a
// dependency describes something.
func TestMountDependenciesWithoutParentSchema(t *testing.T) {
	deps := []models.ChartDependency{{
		Name: "pgbouncer", Key: "pooler",
		Schema: []byte(`{"type":"object","properties":{"poolMode":{"type":"string"}}}`),
	}}
	out, _ := mountDependencies(nil, deps)
	schema := decode(t, out)
	if schema["type"] != "object" {
		t.Errorf("type = %v", schema["type"])
	}
	propertyOf(t, schema, "pooler")
}

// Nothing to mount means nothing to change: the chart's file goes back out as it
// came in, which is what every caller had before dependencies existed.
func TestMountDependenciesWithoutSchemasReturnsParentVerbatim(t *testing.T) {
	parent := []byte(`{"type":"object","properties":{"auth":{"type":"object"}}}`)
	out, _ := mountDependencies(parent, []models.ChartDependency{{Name: "redis", Key: "redis"}})
	if string(out) != string(parent) {
		t.Errorf("effective schema = %s", out)
	}
}

// The effective schema is not just JSON, it is what the order is validated
// against, so the references rewritten into it have to resolve in the validator
// that does the checking - not only when walked by hand.
func TestEffectiveSchemaCompilesAndChecksDependencyValues(t *testing.T) {
	parent := []byte(`{"type":"object","properties":{"auth":{"type":"object"}},"definitions":{"size":{"type":"integer"}}}`)
	deps := []models.ChartDependency{{
		Name: "pgbouncer", Key: "pooler",
		Schema: []byte(`{
		  "type":"object",
		  "properties":{"poolMode":{"$ref":"#/definitions/mode"}},
		  "definitions":{"mode":{"type":"string","enum":["session","transaction"]}}
		}`),
	}}
	out, _ := mountDependencies(parent, deps)

	c := jsonschema.NewCompiler()
	if err := c.AddResource("values.schema.json", bytes.NewReader(out)); err != nil {
		t.Fatalf("add: %v", err)
	}
	sch, err := c.Compile("values.schema.json")
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	if err := sch.Validate(map[string]any{"pooler": map[string]any{"poolMode": "session"}}); err != nil {
		t.Errorf("a value the dependency allows was refused: %v", err)
	}
	if err := sch.Validate(map[string]any{"pooler": map[string]any{"poolMode": "sesion"}}); err == nil {
		t.Error("a value outside the dependency's enum was accepted")
	}
}
