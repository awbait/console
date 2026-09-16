package harbor

import (
	"sort"
	"strings"

	"gopkg.in/yaml.v3"

	"console/pkg/models"
)

// chartMetaDeps is the part of a Chart.yaml the portal reads: the dependency
// list, which is the only place that says under which key a subchart's values
// sit in the parent (its alias, or its chart name when there is no alias).
type chartMetaDeps struct {
	Version      string `yaml:"version"`
	Dependencies []struct {
		Name       string `yaml:"name"`
		Version    string `yaml:"version"`
		Repository string `yaml:"repository"`
		Condition  string `yaml:"condition"`
		Alias      string `yaml:"alias"`
	} `yaml:"dependencies"`
}

// dependenciesOf turns the files pulled out of a chart archive into the
// dependency list the constructor and the order form work from.
//
// Two sources are read and they do not always agree. Chart.yaml declares what
// the chart asked for (with the alias, which nothing else records), and
// "charts/" holds what was actually packaged. A declared dependency with nothing
// packaged still counts - it just has no schema, which is the normal case for an
// external chart. A packaged subchart nobody declared counts too: charts built
// before dependencies were declared vendor "charts/" by hand, and its fields are
// as real as any other.
func dependenciesOf(files map[string][]byte) []models.ChartDependency {
	var meta chartMetaDeps
	_ = yaml.Unmarshal(files["Chart.yaml"], &meta)

	packaged := packagedSubcharts(files)
	out := make([]models.ChartDependency, 0, len(meta.Dependencies)+len(packaged))
	declared := map[string]bool{}
	for _, d := range meta.Dependencies {
		if d.Name == "" {
			continue
		}
		declared[d.Name] = true
		key := d.Alias
		if key == "" {
			key = d.Name
		}
		dep := models.ChartDependency{
			Name:      d.Name,
			Alias:     d.Alias,
			Key:       key,
			Version:   d.Version,
			Condition: d.Condition,
		}
		if sub, ok := packaged[d.Name]; ok {
			dep.Schema = sub.schema
			dep.Values = sub.values
			// A dependency may bring dependencies of its own, and a field of one
			// of those is still a field of the order form: the waypoint of an
			// egress gateway lives in a chart two levels down.
			dep.Dependencies = dependenciesOf(sub.files)
			// The packaged version is what the schema shown actually belongs to;
			// the declared one is often a range ("^7.0.0") and names no artifact.
			if sub.version != "" {
				dep.Version = sub.version
			}
		}
		out = append(out, dep)
	}

	extra := make([]string, 0, len(packaged))
	for name := range packaged {
		if !declared[name] {
			extra = append(extra, name)
		}
	}
	sort.Strings(extra)
	for _, name := range extra {
		sub := packaged[name]
		out = append(out, models.ChartDependency{
			Name: name, Key: name, Version: sub.version, Schema: sub.schema, Values: sub.values,
			Dependencies: dependenciesOf(sub.files),
		})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

type packagedSubchart struct {
	version string
	schema  []byte
	values  []byte
	// files is everything that came with this dependency, addressed as if it
	// were a chart of its own ("values.yaml", "charts/{sub}/values.yaml"). It is
	// what lets the same reading run one level down: a dependency of a dependency
	// is a dependency, and a field of it is a field of the order form.
	files map[string][]byte
}

// packagedSubcharts collects what extractChartFiles took out of "charts/",
// keyed by chart name.
func packagedSubcharts(files map[string][]byte) map[string]packagedSubchart {
	out := map[string]packagedSubchart{}
	for key, body := range files {
		name, file, ok := splitSubchartKey(key)
		if !ok {
			continue
		}
		sub := out[name]
		if sub.files == nil {
			sub.files = map[string][]byte{}
		}
		sub.files[file] = body
		switch file {
		case "values.schema.json":
			sub.schema = body
		case "values.yaml":
			sub.values = body
		case "Chart.yaml":
			var m chartMetaDeps
			if yaml.Unmarshal(body, &m) == nil {
				sub.version = m.Version
			}
		}
		out[name] = sub
	}
	return out
}

// splitSubchartKey reads back a key written by subchartKey: the chart it belongs
// to, and where the file sits inside that chart. A file of a dependency's own
// dependency keeps its path ("charts/waypoint/values.schema.json"), which is
// what the next round of reading takes apart.
func splitSubchartKey(key string) (chart, file string, ok bool) {
	const prefix = "charts/"
	rest, found := strings.CutPrefix(key, prefix)
	if !found {
		return "", "", false
	}
	name, file, found := strings.Cut(rest, "/")
	if !found || name == "" || file == "" {
		return "", "", false
	}
	return name, file, true
}
