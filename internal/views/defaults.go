package views

import (
	"encoding/json"
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
func ApplyDefaults(values map[string]any, viewJSON []byte) map[string]any {
	if values == nil {
		values = map[string]any{}
	}
	for ptr, val := range Defaults(viewJSON) {
		setPointer(values, ptr, val)
	}
	return values
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
