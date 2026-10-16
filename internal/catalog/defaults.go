package catalog

// What an order is checked against.
//
// Helm checks a chart's values.schema.json against the values it has AFTER
// coalescing: the chart's own values.yaml underneath, each dependency's
// values.yaml underneath its key, and whatever was passed in on top. The portal
// checks the same. Checking only what the order form sent is a stricter
// standard than the one the order will actually be held to: it refused fields
// the chart already answers, and the person filling in the form had to repeat
// them.
//
// Nothing here is written anywhere. The order keeps its own values, and Helm
// does this same coalescing again at install time: persisting the merged result
// would freeze today's chart defaults into every order and make an upgrade stop
// changing what nobody touched.

import (
	"context"

	"gopkg.in/yaml.v3"

	"console/pkg/models"
)

// ValuesForValidation returns the order's values with the chart's defaults
// underneath them, the way Helm will see them: the chart's own values.yaml and
// the values.yaml of each of its dependencies.
//
// The chart's own values.yaml counts too. A field the chart answers there is a
// field Helm never finds empty, so a required on it holds nobody to anything at
// install time - yet the portal refused orders that left it out, most visibly
// on fields the form does not even show. What nobody answers stays required:
// the chart left it to the person ordering.
//
// A field under a dependency's key is nobody's to fill in. The form does not
// show it - charts keep those blocks hidden - the chart author answers it in the
// dependency's own values.yaml, and Helm hands that answer over before checking
// anything.
//
// Best effort by design: a file that cannot be read is left out and the order
// is checked without it. Refusing an order because a file the person never
// asked about is missing would be a worse answer than a check that is merely
// too strict.
func (s *Service) ValuesForValidation(ctx context.Context, project, name, version string,
	values map[string]any) map[string]any {

	own := map[string]any{}
	if b, err := s.GetValues(ctx, project, name, version); err == nil {
		if decoded := decodeValues(b); decoded != nil {
			own = decoded
		}
	}
	defaults := own
	// What the parent says about its dependencies sits over what each dependency
	// says about itself, and both sit under the order.
	if deps, err := s.Dependencies(ctx, project, name, version); err == nil && len(deps) > 0 {
		defaults = Coalesce(dependencyDefaults(deps, own), own)
	}
	if len(defaults) == 0 {
		return values
	}
	return Coalesce(values, defaults)
}

// dependencyDefaults is what the chart answers for its dependencies: each one's
// own values.yaml with what the parent says about it laid over the top, and the
// same done for its own dependencies one level down. Helm coalesces the whole
// tree before it checks anything, so a field answered by a chart three levels
// down is answered as far as the order is concerned.
func dependencyDefaults(deps []models.ChartDependency, own map[string]any) map[string]any {
	defaults := map[string]any{}
	for _, dep := range deps {
		if dep.Key == "" {
			continue
		}
		sub := map[string]any{}
		if len(dep.Values) > 0 {
			if decoded := decodeValues(dep.Values); decoded != nil {
				sub = decoded
			}
		}
		// "global" is the parent's, handed down by Helm; a dependency's own copy
		// of it describes the chart installed on its own and says nothing here.
		delete(sub, "global")
		if nested := dependencyDefaults(dep.Dependencies, sub); len(nested) > 0 {
			sub = Coalesce(sub, nested)
		}
		fromParent, _ := own[dep.Key].(map[string]any)
		merged := Coalesce(fromParent, sub)
		if len(merged) == 0 {
			continue
		}
		defaults[dep.Key] = merged
	}
	return defaults
}

func decodeValues(b []byte) map[string]any {
	var m map[string]any
	if err := yaml.Unmarshal(b, &m); err != nil {
		return nil
	}
	return m
}

// Coalesce lays defaults underneath values, the way Helm does it.
//
// Two maps merge key by key and the value wins on a conflict. Anything else -
// a list, a scalar - is taken whole from the value, never merged: Helm replaces
// a list rather than joining it, and a portal that joined them would start
// accepting orders Helm refuses, which is worse than the strictness it is
// replacing.
//
// A key the value sets to null is Helm's way of saying "not this one": the
// default underneath is dropped rather than shown through.
func Coalesce(values, defaults map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range defaults {
		out[k] = v
	}
	for k, v := range values {
		if v == nil {
			delete(out, k)
			continue
		}
		vm, valueIsMap := v.(map[string]any)
		dm, defaultIsMap := out[k].(map[string]any)
		if valueIsMap && defaultIsMap {
			out[k] = Coalesce(vm, dm)
			continue
		}
		out[k] = v
	}
	return out
}
