package catalog

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"strings"

	"console/pkg/models"
)

// A chart's dependencies and the one schema built out of them.
//
// Helm puts a dependency's values in the parent's values under its alias, or
// under its chart name when there is no alias, and validates the result against
// the schemas of both. The portal does the same thing once, here: the effective
// schema is the chart's own values.schema.json with each dependency's schema
// mounted under that key. Everything downstream then stops knowing that
// dependencies exist - "/pooler/poolMode" is an ordinary path into the order's
// values, the order form draws an ordinary field, and validation is the
// validation Argo would do later, only sooner.

// depDefinition is where a mounted dependency's schema document is kept inside
// the effective schema, so its own "#/definitions/..." references keep pointing
// at its own definitions and not at same-named ones in the parent.
func depDefinition(key string) string { return "dependency:" + key }

// Dependencies returns the chart version's first-level dependencies, each with
// its own values.schema.json when the packaged subchart carries one.
func (s *Service) Dependencies(ctx context.Context, project, name, version string) ([]models.ChartDependency, error) {
	b, err := s.blob(ctx, "deps", project, name, version, func(ctx context.Context, p, n, v string) ([]byte, error) {
		deps, err := s.hb.GetDependencies(ctx, p, n, v)
		if err != nil {
			return nil, err
		}
		for i := range deps {
			// A schema that is not JSON cannot be cached, mounted or shown. Drop it
			// and say so: the tab would otherwise be silently missing.
			if len(deps[i].Schema) > 0 && !json.Valid(deps[i].Schema) {
				deps[i].Schema = nil
				deps[i].Warning = "values.schema.json зависимости не читается как JSON, её поля недоступны"
			}
		}
		return json.Marshal(deps)
	})
	if err != nil {
		return nil, err
	}
	var deps []models.ChartDependency
	if uerr := json.Unmarshal(b, &deps); uerr != nil {
		return nil, fmt.Errorf("catalog: decode dependencies: %w", uerr)
	}
	return deps, nil
}

// FormSchema returns the schema an order of this chart version is drawn from and
// checked against, together with the dependencies that went into it (annotated
// with anything the portal noticed while mounting them).
//
// A chart with no dependencies gets its own values.schema.json back, byte for
// byte, which is what every caller had before dependencies existed.
func (s *Service) FormSchema(ctx context.Context, project, name, version string) ([]byte, []models.ChartDependency, error) {
	schema, schemaErr := s.GetSchema(ctx, project, name, version)
	deps, depsErr := s.Dependencies(ctx, project, name, version)
	if depsErr != nil {
		// The dependency list rides on the same archive as the schema, so a failure
		// here is a failure to read the chart at all. Keep the schema error as the
		// one reported: it is the older, better-understood half.
		if schemaErr != nil {
			return nil, nil, schemaErr
		}
		return nil, nil, depsErr
	}
	if len(deps) == 0 {
		return schema, nil, schemaErr
	}
	effective, deps := mountDependencies(schema, deps)
	if effective == nil {
		return nil, deps, schemaErr
	}
	return effective, deps, nil
}

// mountDependencies builds the effective schema. It returns nil when there is
// nothing to build from: no parent schema and no dependency that has one.
func mountDependencies(parent []byte, deps []models.ChartDependency) ([]byte, []models.ChartDependency) {
	root := map[string]any{}
	if len(parent) > 0 {
		if json.Unmarshal(parent, &root) != nil {
			// A chart schema that is not JSON is the chart's problem and is already
			// reported where it is read; mounting on top of it would only replace
			// that error with a stranger one.
			return nil, deps
		}
	}
	// A parent that forbids unknown keys and does not describe the dependency
	// itself is a chart Helm will refuse at install time, whatever the portal
	// does: it checks the whole values against this file, subchart keys included.
	allowExtra, isBool := root["additionalProperties"].(bool)
	strict := isBool && !allowExtra

	declared, _ := root["properties"].(map[string]any)
	props := map[string]any{}
	maps.Copy(props, declared)
	defs, _ := root["definitions"].(map[string]any)
	definitions := map[string]any{}
	maps.Copy(definitions, defs)

	mounted := 0
	for i := range deps {
		dep := &deps[i]
		if dep.Key == "" || len(dep.Schema) == 0 {
			continue
		}
		var doc map[string]any
		if json.Unmarshal(dep.Schema, &doc) != nil {
			continue
		}
		if _, taken := declared[dep.Key]; taken {
			dep.Warning = fmt.Sprintf(
				"Схема чарта уже описывает поле %q, поэтому форма берёт его оттуда, а не из зависимости", dep.Key)
			continue
		}
		def := depDefinition(dep.Key)
		rewriteRefs(doc, "#/definitions/"+def)
		delete(doc, "$schema")
		delete(doc, "$id")
		definitions[def] = doc

		node := map[string]any{}
		maps.Copy(node, doc)
		// "global" in a subchart's schema describes values Helm reads from the root
		// of the parent, not from under the subchart's key. Mounted as it stands it
		// would offer a field whose value goes nowhere.
		if p, ok := node["properties"].(map[string]any); ok {
			without := map[string]any{}
			for k, v := range p {
				if k != "global" {
					without[k] = v
				}
			}
			node["properties"] = without
		}
		node[models.SchemaDependencyAnnotation] = dep.Name
		props[dep.Key] = node
		mounted++
		if strict {
			dep.Warning = fmt.Sprintf(
				"Схема чарта запрещает лишние ключи (additionalProperties: false) и не описывает %q. "+
					"Helm отклонит values заказа, пока поле не появится в values.schema.json чарта", dep.Key)
		}
	}
	if mounted == 0 {
		if len(parent) == 0 {
			return nil, deps
		}
		return parent, deps
	}
	root["properties"] = props
	root["definitions"] = definitions
	if _, ok := root["type"]; !ok {
		root["type"] = "object"
	}
	out, err := json.Marshal(root)
	if err != nil {
		return nil, deps
	}
	return out, deps
}

// rewriteRefs re-points every local "$ref" of a schema document at where the
// document now lives inside the parent: "#/definitions/foo" read from a subchart
// becomes "#/definitions/dependency:pooler/definitions/foo".
func rewriteRefs(node any, base string) {
	switch n := node.(type) {
	case map[string]any:
		if ref, ok := n["$ref"].(string); ok && strings.HasPrefix(ref, "#") {
			n["$ref"] = base + strings.TrimPrefix(ref, "#")
		}
		for _, v := range n {
			rewriteRefs(v, base)
		}
	case []any:
		for _, v := range n {
			rewriteRefs(v, base)
		}
	}
}

// DependencyKeys lists the values keys the dependencies of a chart version sit
// under, which is how a view document names their fields ("pooler/poolMode").
func DependencyKeys(deps []models.ChartDependency) []string {
	out := make([]string, 0, len(deps))
	for _, d := range deps {
		if d.Key != "" {
			out = append(out, d.Key)
		}
	}
	return out
}
