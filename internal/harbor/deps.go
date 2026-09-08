package harbor

import (
	"sort"

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
			Name: name, Key: name, Version: sub.version, Schema: sub.schema,
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
		switch file {
		case "values.schema.json":
			sub.schema = body
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

// splitSubchartKey reads back a key written by subchartKey.
func splitSubchartKey(key string) (chart, file string, ok bool) {
	const prefix = "charts/"
	if len(key) <= len(prefix) || key[:len(prefix)] != prefix {
		return "", "", false
	}
	rest := key[len(prefix):]
	for i := len(rest) - 1; i >= 0; i-- {
		if rest[i] == '/' {
			return rest[:i], rest[i+1:], rest[:i] != "" && i+1 < len(rest)
		}
	}
	return "", "", false
}
