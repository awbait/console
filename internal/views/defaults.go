package views

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
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
// Intermediate objects are created as needed and array indexes address items
// that are already there (see setPointer). Returns the (mutated) values map and
// the pointers that found nothing to write into - a list nobody blames the
// order for, but which the portal logs rather than swallowing.
//
// A string value may reference what the portal knows about the order being
// written ("{{.Team}}", "{{.User.Name}}" - see tmpl.go). A reference nothing
// answers to fails the whole stamp instead of writing an empty string: the
// result goes to Git and into the cluster, where a value that quietly went
// missing is found much later and by accident.
func ApplyDefaults(values map[string]any, viewJSON []byte, data TemplateData) (map[string]any, []string, error) {
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
	var skipped []string
	for _, ptr := range ptrs {
		val := defs[ptr]
		if s, ok := val.(string); ok {
			rendered, err := RenderTemplate(s, data)
			if err != nil {
				return values, skipped, fmt.Errorf("поле «%s»: %w", ptr, err)
			}
			val = rendered
		}
		if !setPointer(values, ptr, val) {
			skipped = append(skipped, ptr)
		}
	}
	return values, skipped, nil
}

// setPointer sets val at an RFC6901 pointer in m and reports whether it wrote
// anything. Intermediate objects are created as needed.
//
// A numeric segment addresses an item of a list that is already there:
// "/gateways/0/ipAddress" writes into the gateway the order has. Missing items
// are NOT invented - how many gateways an order has is the order's business,
// and a default cannot add one - so a pointer past the end of a list writes
// nothing and says so. Same for a segment whose key is occupied by a scalar:
// clobbering somebody's value with an object is worse than not writing.
func setPointer(m map[string]any, pointer string, val any) bool {
	if pointer == "" || !strings.HasPrefix(pointer, "/") {
		return false
	}
	segs := strings.Split(strings.TrimPrefix(pointer, "/"), "/")
	var cur any = m
	for i, seg := range segs {
		// RFC6901 unescaping: ~1 -> "/", ~0 -> "~" (order matters).
		seg = strings.ReplaceAll(strings.ReplaceAll(seg, "~1", "/"), "~0", "~")
		last := i == len(segs)-1
		switch node := cur.(type) {
		case map[string]any:
			if last {
				node[seg] = val
				return true
			}
			next, exists := node[seg]
			if !exists {
				// Nothing here yet: an object can be created, a list cannot -
				// the next segment says which one the pointer wants.
				if isIndex(segs[i+1]) {
					return false
				}
				fresh := map[string]any{}
				node[seg] = fresh
				cur = fresh
				continue
			}
			cur = next
		case []any:
			idx, err := strconv.Atoi(seg)
			if err != nil || idx < 0 || idx >= len(node) {
				return false
			}
			if last {
				node[idx] = val
				return true
			}
			cur = node[idx]
		default:
			return false // a scalar on the way: not ours to replace
		}
	}
	return false
}
