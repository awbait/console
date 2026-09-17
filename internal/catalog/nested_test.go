package catalog

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/santhosh-tekuri/jsonschema/v5"

	"console/pkg/models"
)

// The shape a real chart tree has: an egress gateway holds a namespace under an
// alias, and the namespace holds the waypoint whose list the order form draws.
// The namespace's own schema leaves "waypoint" as a placeholder - a block with a
// title and nothing in it - which is what every chart does for a subchart.
func nestedDeps() []models.ChartDependency {
	waypoint := models.ChartDependency{
		Name: "waypoint", Key: "waypoint", Version: "2.3.0",
		Schema: json.RawMessage(`{
		  "type": "object",
		  "properties": {
		    "waypoints": {
		      "title": "Гейтвеи",
		      "type": "array",
		      "items": {"$ref": "#/definitions/waypoint"}
		    }
		  },
		  "definitions": {
		    "waypoint": {
		      "type": "object",
		      "required": ["name"],
		      "properties": {"name": {"type": "string"}}
		    }
		  }
		}`),
		Values: []byte("waypoints: []\nreplicas: 2\n"),
	}
	return []models.ChartDependency{{
		Name: "namespace", Key: "waypointNamespace", Alias: "waypointNamespace", Version: "6.1.0",
		Schema: json.RawMessage(`{
		  "type": "object",
		  "additionalProperties": false,
		  "properties": {
		    "waypoint": {"title": "Waypoint subchart", "type": "object", "ui:widget": "hidden"},
		    "enabled": {"type": "boolean"}
		  }
		}`),
		Values:       []byte("enabled: true\n"),
		Dependencies: []models.ChartDependency{waypoint},
	}}
}

const gatewaySchema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {"waypointNamespace": {"title": "Namespace гейтвея", "type": "object"}}
}`

// A view names a field of a chart two levels down ("waypointNamespace/waypoint/
// waypoints"), and that field has to exist in the effective schema - otherwise
// the form skips it in silence and the person opens an empty page.
func TestADependencyOfADependencyIsMountedToo(t *testing.T) {
	effective, _ := mountDependencies([]byte(gatewaySchema), nestedDeps())
	if effective == nil {
		t.Fatal("nothing was mounted")
	}
	schema := decode(t, effective)

	ns := propertyOf(t, schema, "waypointNamespace")
	wp, ok := ns["properties"].(map[string]any)["waypoint"].(map[string]any)
	if !ok {
		t.Fatalf("the namespace has no waypoint: %v", keysOf(ns["properties"].(map[string]any)))
	}
	props, _ := wp["properties"].(map[string]any)
	if _, ok := props["waypoints"]; !ok {
		t.Fatalf("the waypoint's own fields are missing: %v", keysOf(props))
	}
	// The chart's own wording for the block it declared survives being filled in.
	if wp["title"] != "Waypoint subchart" {
		t.Errorf("title = %v, want what the namespace chart called it", wp["title"])
	}
}

// Mounting rewrites a schema's local references to where that schema now lives.
// Two levels deep that has to hold twice over, or the effective schema does not
// compile and every order of the chart is refused.
func TestANestedSchemaCompilesAndChecksItsFields(t *testing.T) {
	effective, _ := mountDependencies([]byte(gatewaySchema), nestedDeps())
	compiler := jsonschema.NewCompiler()
	if err := compiler.AddResource("effective.json", bytes.NewReader(effective)); err != nil {
		t.Fatalf("add resource: %v", err)
	}
	sch, err := compiler.Compile("effective.json")
	if err != nil {
		t.Fatalf("the effective schema does not compile: %v", err)
	}

	ok := map[string]any{"waypointNamespace": map[string]any{
		"waypoint": map[string]any{"waypoints": []any{map[string]any{"name": "egw"}}},
	}}
	if err := sch.Validate(ok); err != nil {
		t.Fatalf("a waypoint the chart accepts was refused: %v", err)
	}

	bad := map[string]any{"waypointNamespace": map[string]any{
		"waypoint": map[string]any{"waypoints": []any{map[string]any{"nome": "egw"}}},
	}}
	if err := sch.Validate(bad); err == nil {
		t.Fatal("a waypoint with no name went through: the nested definitions did not travel")
	}
}

// Helm hands every chart in the tree its own values.yaml before it checks
// anything, so a field answered by a chart two levels down is answered as far as
// the order is concerned.
func TestDefaultsComeFromTheWholeTree(t *testing.T) {
	defaults := dependencyDefaults(nestedDeps(), map[string]any{
		"waypointNamespace": map[string]any{"enabled": false},
	})
	ns, _ := defaults["waypointNamespace"].(map[string]any)
	if ns == nil {
		t.Fatalf("the namespace answered nothing: %v", defaults)
	}
	// What the parent says about the dependency wins over the dependency's own.
	if ns["enabled"] != false {
		t.Errorf("enabled = %v, want what the parent chart says", ns["enabled"])
	}
	wp, _ := ns["waypoint"].(map[string]any)
	if wp == nil {
		t.Fatalf("the waypoint answered nothing: %v", keysOf(ns))
	}
	if wp["replicas"] != 2 {
		t.Errorf("replicas = %v, want the waypoint chart's own answer", wp["replicas"])
	}
}
