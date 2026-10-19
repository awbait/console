package views

import (
	"reflect"
	"sort"
)

// Copying an order keeps its values and renders again only what the portal
// filled in itself and what has a different answer for the copy: a value
// seeded from the service name follows the new name, one seeded from a
// variable follows the new stand. Everything else in the order is what the
// person decided.

// RenderInitialChanged renders the entries of the "initial" block for the
// copy (now) and for the original (was), and returns, as pointer -> value,
// those whose answer differs. An entry that renders the same for both is left
// out: what it seeded the first time is already in the order, edited or not,
// and a copy is not a fresh form. An entry that does not render for the
// original (a variable since removed, a stand that is gone) counts as changed.
// Only a failure for the copy is an error, because that is the value the copy
// would carry.
func RenderInitialChanged(viewJSON []byte, was, now TemplateData, schemaJSON []byte) (map[string]any, error) {
	initial := Initial(viewJSON)
	out := map[string]any{}
	if len(initial) == 0 {
		return out, nil
	}
	schema := parseSchema(schemaJSON)
	ptrs := make([]string, 0, len(initial))
	for ptr, val := range initial {
		if _, ok := val.(string); ok {
			ptrs = append(ptrs, ptr)
		}
	}
	sort.Strings(ptrs)
	for _, ptr := range ptrs {
		val, err := renderValue(initial[ptr], ptr, now, schema)
		if err != nil {
			return out, err
		}
		if before, err := renderValue(initial[ptr], ptr, was, schema); err == nil && reflect.DeepEqual(before, val) {
			continue
		}
		out[ptr] = val
	}
	return out, nil
}

// Overlay writes rendered values into the order's values by pointer, over
// whatever is there, the way defaults are stamped. It returns the pointers
// that found nothing to write into (see setPointer), for the log.
func Overlay(values map[string]any, rendered map[string]any) []string {
	ptrs := make([]string, 0, len(rendered))
	for ptr := range rendered {
		ptrs = append(ptrs, ptr)
	}
	sort.Strings(ptrs)
	var skipped []string
	for _, ptr := range ptrs {
		if !setPointer(values, ptr, rendered[ptr]) {
			skipped = append(skipped, ptr)
		}
	}
	return skipped
}
