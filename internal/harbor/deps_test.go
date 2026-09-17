package harbor

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"testing"
)

// tgz packs the given files (name -> body) into a gzipped tar.
func tgz(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for name, body := range files {
		if err := tw.WriteHeader(&tar.Header{
			Name: name, Mode: 0o644, Size: int64(len(body)), Typeflag: tar.TypeReg,
		}); err != nil {
			t.Fatalf("tar header %s: %v", name, err)
		}
		if _, err := tw.Write([]byte(body)); err != nil {
			t.Fatalf("tar write %s: %v", name, err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatalf("tar close: %v", err)
	}
	if err := gz.Close(); err != nil {
		t.Fatalf("gzip close: %v", err)
	}
	return buf.Bytes()
}

const poolerSchema = `{"type":"object","properties":{"poolMode":{"type":"string"}}}`

// A dependency arrives in the parent archive in two shapes and both are met in
// practice: unpacked under "charts/{dep}/", and packaged as "charts/{dep}.tgz",
// which is what "helm dependency build" leaves behind for a local dependency.
func TestExtractChartFilesReadsBothDependencyShapes(t *testing.T) {
	inner := tgz(t, map[string]string{
		"pgbouncer/Chart.yaml":         "name: pgbouncer\nversion: 1.22.0\n",
		"pgbouncer/values.schema.json": poolerSchema,
		"pgbouncer/values.yaml":        "poolMode: transaction\n",
		// A dependency of the dependency, which is read too: its fields are as
		// much a part of the order as any other.
		"pgbouncer/charts/deep/values.schema.json": `{"type":"object"}`,
	})
	parent := tgz(t, map[string]string{
		"postgres/Chart.yaml":                                    "name: postgres\nversion: 15.4.2\n",
		"postgres/values.schema.json":                            `{"type":"object"}`,
		"postgres/charts/pgbouncer-1.22.0.tgz":                   string(inner),
		"postgres/charts/metrics/Chart.yaml":                     "name: metrics\nversion: 2.0.0\n",
		"postgres/charts/metrics/values.schema.json":             `{"type":"object","properties":{"port":{"type":"integer"}}}`,
		"postgres/charts/metrics/values.yaml":                    "port: 9187\n", // not served, only the schema is
		"postgres/charts/metrics/charts/deep/values.schema.json": `{"type":"object"}`,
	})

	files, err := extractChartFiles(parent)
	if err != nil {
		t.Fatalf("extract: %v", err)
	}
	if got := string(files[subchartKey("pgbouncer", "values.schema.json")]); got != poolerSchema {
		t.Errorf("packaged dependency schema = %q", got)
	}
	if _, ok := files[subchartKey("metrics", "values.schema.json")]; !ok {
		t.Error("unpacked dependency schema missing")
	}
	// The dependency's own values travel too: Helm coalesces them under the
	// dependency's key before it checks any schema, so an order is held to what
	// Helm would accept only when the portal has them.
	if got := string(files[subchartKey("metrics", "values.yaml")]); got != "port: 9187\n" {
		t.Errorf("unpacked dependency values = %q", got)
	}
	// A dependency of a dependency keeps its place in the tree, under the
	// dependency that brought it: that is where its fields live in the values
	// too, and a view has no other way to name them.
	for _, key := range []string{
		subchartKey("pgbouncer", "charts/deep/values.schema.json"),
		subchartKey("metrics", "charts/deep/values.schema.json"),
	} {
		if _, ok := files[key]; !ok {
			t.Errorf("a dependency of a dependency was dropped: %s", key)
		}
	}
}

// The chart tree is read as deep as the archive goes, and the dependency list
// keeps its shape: a waypoint under a namespace under a gateway is where the
// order form finds the fields the view names.
func TestDependenciesOfKeepsTheTree(t *testing.T) {
	waypoint := tgz(t, map[string]string{
		"waypoint/Chart.yaml":         "name: waypoint\nversion: 2.3.0\n",
		"waypoint/values.schema.json": `{"type":"object","properties":{"waypoints":{"type":"array"}}}`,
		"waypoint/values.yaml":        "waypoints: []\n",
	})
	namespace := tgz(t, map[string]string{
		"namespace/Chart.yaml": "name: namespace\nversion: 6.1.0\n" +
			"dependencies:\n  - name: waypoint\n    version: 2.3.0\n",
		"namespace/values.schema.json":  `{"type":"object","properties":{"waypoint":{"type":"object"}}}`,
		"namespace/values.yaml":         "podSecurity: baseline\n",
		"namespace/charts/waypoint.tgz": string(waypoint),
	})
	parent := tgz(t, map[string]string{
		"egress-gateway/Chart.yaml": "name: egress-gateway\nversion: 8.0.0\n" +
			"dependencies:\n  - name: namespace\n    version: 6.1.0\n    alias: waypointNamespace\n",
		"egress-gateway/values.schema.json":   `{"type":"object"}`,
		"egress-gateway/charts/namespace.tgz": string(namespace),
	})

	files, err := extractChartFiles(parent)
	if err != nil {
		t.Fatalf("extract: %v", err)
	}
	deps := dependenciesOf(files)
	if len(deps) != 1 {
		t.Fatalf("dependencies = %d, want the one namespace", len(deps))
	}
	ns := deps[0]
	if ns.Key != "waypointNamespace" {
		t.Errorf("key = %q, want the alias the values sit under", ns.Key)
	}
	if len(ns.Dependencies) != 1 {
		t.Fatalf("the namespace brought %d dependencies, want its waypoint", len(ns.Dependencies))
	}
	wp := ns.Dependencies[0]
	if wp.Key != "waypoint" || wp.Version != "2.3.0" {
		t.Errorf("waypoint = %q %q", wp.Key, wp.Version)
	}
	if len(wp.Schema) == 0 {
		t.Error("the waypoint's schema is what the order form draws, and it is missing")
	}
	if len(wp.Values) == 0 {
		t.Error("the waypoint's own values decide what the order has to answer, and they are missing")
	}
}

// The key a dependency's values sit under is its alias when it has one, and the
// alias is written down in exactly one place: the parent's Chart.yaml. The
// directory in "charts/" is named after the chart, so without reading both the
// schema cannot be attached to the right key.
func TestDependenciesOfUsesAliasAsKey(t *testing.T) {
	files := map[string][]byte{
		"Chart.yaml": []byte(`
name: postgres
version: 15.4.2
dependencies:
  - name: pgbouncer
    version: "^1.22.0"
    alias: pooler
    condition: pooler.enabled
  - name: absent
    version: "1.0.0"
`),
		subchartKey("pgbouncer", "Chart.yaml"):         []byte("name: pgbouncer\nversion: 1.22.3\n"),
		subchartKey("pgbouncer", "values.schema.json"): []byte(poolerSchema),
	}

	deps := dependenciesOf(files)
	if len(deps) != 2 {
		t.Fatalf("dependencies = %d, want 2", len(deps))
	}
	pooler := deps[0]
	if pooler.Key != "pooler" || pooler.Name != "pgbouncer" || pooler.Alias != "pooler" {
		t.Errorf("aliased dependency = %+v", pooler)
	}
	if pooler.Condition != "pooler.enabled" {
		t.Errorf("condition = %q", pooler.Condition)
	}
	// The packaged version, not the "^1.22.0" range: it is the version the schema
	// shown actually belongs to.
	if pooler.Version != "1.22.3" {
		t.Errorf("version = %q, want the packaged 1.22.3", pooler.Version)
	}
	if string(pooler.Schema) != poolerSchema {
		t.Errorf("schema = %q", pooler.Schema)
	}
	// A dependency nothing packaged is still a dependency; most external charts
	// simply have no values.schema.json.
	if deps[1].Key != "absent" || len(deps[1].Schema) != 0 {
		t.Errorf("undeclared-schema dependency = %+v", deps[1])
	}
}

// A chart that vendors "charts/" by hand, without declaring anything, still has
// those fields in its values. Dropping them would hide half the form.
func TestDependenciesOfPicksUpUndeclaredSubcharts(t *testing.T) {
	deps := dependenciesOf(map[string][]byte{
		"Chart.yaml": []byte("name: postgres\nversion: 1.0.0\n"),
		subchartKey("metrics", "values.schema.json"): []byte(poolerSchema),
		subchartKey("metrics", "Chart.yaml"):         []byte("name: metrics\nversion: 2.0.0\n"),
	})
	if len(deps) != 1 || deps[0].Key != "metrics" || deps[0].Version != "2.0.0" {
		t.Fatalf("dependencies = %+v", deps)
	}
}

func TestDependenciesOfEmptyChart(t *testing.T) {
	if deps := dependenciesOf(map[string][]byte{"Chart.yaml": []byte("name: solo\n")}); deps != nil {
		t.Fatalf("dependencies = %+v, want none", deps)
	}
}
