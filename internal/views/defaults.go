package views

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// Defaults returns the "defaults" block of a view document: a map from an
// RFC6901 JSON pointer (e.g. "/namespace/creator") to the value the portal
// stamps into an order at create/update time. Returns nil when the block is
// absent or malformed.
//
// The block lets a chart declare order-time provenance or fixed values in its
// own view document, so the portal can apply them without any chart-specific
// code (it stays chart-agnostic). Semantics are overwrite ("перезапись"): the
// declared value replaces whatever the form submitted, so it suits fields that
// are hidden from the order form (e.g. cpaas.io/creator = console).
func Defaults(viewJSON []byte) map[string]any {
	var doc struct {
		Defaults map[string]any `json:"defaults"`
	}
	if err := json.Unmarshal(viewJSON, &doc); err != nil {
		return nil
	}
	return doc.Defaults
}

// ApplyDefaults stamps the view document's defaults (pointer -> value) into the
// values map, OVERWRITING any value already present at each pointer.
// Intermediate objects are created as needed. A pointer that would have to
// descend through a non-object (an array index, or a key already holding a
// scalar/array) is skipped, so defaults target object fields. Returns the
// (mutated) values map.
//
// A string value may reference what the portal knows about the order being
// written ("{{.Team}}", "{{.User.Name}}" - see tmpl.go). A reference nothing
// answers to fails the whole stamp instead of writing an empty string: the
// result goes to Git and into the cluster, where a value that quietly went
// missing is found much later and by accident.
func ApplyDefaults(values map[string]any, viewJSON []byte, data TemplateData) (map[string]any, error) {
	if values == nil {
		values = map[string]any{}
	}
	defs := Defaults(viewJSON)
	// Sorted, so a document with two broken defaults always names the same one
	// first: map order would otherwise make the complaint change between saves.
	ptrs := make([]string, 0, len(defs))
	for ptr := range defs {
		ptrs = append(ptrs, ptr)
	}
	sort.Strings(ptrs)
	for _, ptr := range ptrs {
		val := defs[ptr]
		if s, ok := val.(string); ok {
			rendered, err := RenderTemplate(s, data)
			if err != nil {
				return values, fmt.Errorf("поле «%s»: %w", ptr, err)
			}
			val = rendered
		}
		setPointer(values, ptr, val)
	}
	return values, nil
}

// setPointer sets val at an RFC6901 object pointer in m, creating intermediate
// maps. It does not descend into arrays: a numeric segment, or a segment whose
// key already holds a non-object, aborts the set (defaults address object
// fields only).
func setPointer(m map[string]any, pointer string, val any) {
	if pointer == "" || !strings.HasPrefix(pointer, "/") {
		return
	}
	segs := strings.Split(strings.TrimPrefix(pointer, "/"), "/")
	cur := m
	for i, seg := range segs {
		// RFC6901 unescaping: ~1 -> "/", ~0 -> "~" (order matters).
		seg = strings.ReplaceAll(strings.ReplaceAll(seg, "~1", "/"), "~0", "~")
		if i == len(segs)-1 {
			cur[seg] = val
			return
		}
		next, ok := cur[seg].(map[string]any)
		if !ok {
			if _, exists := cur[seg]; exists {
				return // occupied by a non-object; do not clobber it
			}
			next = map[string]any{}
			cur[seg] = next
		}
		cur = next
	}
}
