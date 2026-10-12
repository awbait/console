package views

import "sort"

// Copying an order to another stand keeps its values and renders again only
// what the portal filled in from the platform's variables: those are the
// values that differ between stands by design (a domain, a prefix), while
// everything else in the order is what the person decided.

// RenderInitialVariables renders the entries of the "initial" block whose
// template names a platform variable, as pointer -> value. Entries without a
// variable are left out: what they seeded the first time is already in the
// order, edited or not, and a copy is not a fresh form.
func RenderInitialVariables(viewJSON []byte, data TemplateData, schemaJSON []byte) (map[string]any, error) {
	initial := Initial(viewJSON)
	out := map[string]any{}
	if len(initial) == 0 {
		return out, nil
	}
	schema := parseSchema(schemaJSON)
	ptrs := make([]string, 0, len(initial))
	for ptr, val := range initial {
		if s, ok := val.(string); ok && usesVariable(s) {
			ptrs = append(ptrs, ptr)
		}
	}
	sort.Strings(ptrs)
	for _, ptr := range ptrs {
		val, err := renderValue(initial[ptr], ptr, data, schema)
		if err != nil {
			return out, err
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

// usesVariable reports whether a template references a platform variable.
func usesVariable(s string) bool {
	uses := false
	_, _ = walkTemplate(s, func(ref string) (string, error) {
		if _, ok := varName(ref); ok {
			uses = true
		}
		return "", nil
	})
	return uses
}
