package catalog

// What an order is checked against.
//
// Helm checks a chart's values.schema.json against the values it has AFTER
// coalescing: the chart's own values.yaml underneath, each dependency's
// values.yaml underneath its key, and whatever was passed in on top. The portal
// used to check only what the order form sent, which is a stricter standard than
// the one the order will actually be held to - so it refused fields the chart
// already answers, and the person filling in the form had to repeat them.
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

// ValuesForValidation returns the order's values with the defaults of the
// chart's dependencies underneath them, the way Helm will see them.
//
// Only the dependencies, deliberately, though Helm coalesces the chart's own
// values.yaml the same way. A field of the chart itself is a field of the order
// form: the person fills it in, and the portal refusing an order that skips one
// is a guard somebody put there on purpose - "an incomplete draft cannot be
// submitted" is a rule, not an accident of the checking. Relaxing it is a
// product decision and does not belong in a fix about being wrong.
//
// A field under a dependency's key is nobody's to fill in. The form does not
// show it - charts keep those blocks hidden - the chart author answers it in the
// dependency's own values.yaml, and Helm hands that answer over before checking
// anything. Holding the order to a standard Helm does not apply there only made
// people copy the chart's own values into their order.
//
// Best effort by design: a dependency whose values cannot be read is checked as
// before. Refusing an order because a file the person never asked about is
// missing would be a worse answer than a check that is merely too strict.
func (s *Service) ValuesForValidation(ctx context.Context, project, name, version string,
	values map[string]any) map[string]any {

	deps, err := s.Dependencies(ctx, project, name, version)
	if err != nil || len(deps) == 0 {
		return values
	}
	// What the parent says about its dependencies sits over what each dependency
	// says about itself, and both sit under the order.
	own := map[string]any{}
	if b, verr := s.GetValues(ctx, project, name, version); verr == nil {
		if decoded := decodeValues(b); decoded != nil {
			own = decoded
		}
	}
	defaults := dependencyDefaults(deps, own)
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
