package views

import (
	"encoding/json"
	"strconv"
	"strings"
)

// OrderIdentity returns the JSON pointer declared as views.order.identity in a
// view document, or "" when absent or malformed. The pointer marks the values
// field that identifies a deployed instance (e.g. "/gateways/0/name"); the
// provisioning layer resolves it against an order's values to detect resource
// name collisions between orders that share a namespace.
func OrderIdentity(viewJSON []byte) string {
	var doc struct {
		Views map[string]struct {
			Identity string `json:"identity"`
		} `json:"views"`
	}
	if err := json.Unmarshal(viewJSON, &doc); err != nil {
		return ""
	}
	return doc.Views["order"].Identity
}

// ResolvePointer resolves an RFC6901 JSON pointer (e.g. "/gateways/0/name")
// against decoded values and returns the target rendered as a string. Numeric
// segments index into arrays. ok is false when the path does not resolve or the
// target is not a scalar. data is expected to be the result of JSON/YAML
// decoding (map[string]any / []any / scalars).
func ResolvePointer(data any, pointer string) (string, bool) {
	node, ok := resolveValuePointer(data, pointer)
	if !ok {
		return "", false
	}
	return scalarString(node)
}

// resolveValuePointer is ResolvePointer without the scalar requirement: it
// returns whatever the pointer lands on, so callers after a list or an object
// (the graph's entries, say) can have it too.
func resolveValuePointer(data any, pointer string) (any, bool) {
	if pointer == "" || !strings.HasPrefix(pointer, "/") {
		return nil, false
	}
	cur := data
	for seg := range strings.SplitSeq(strings.TrimPrefix(pointer, "/"), "/") {
		// RFC6901 unescaping: ~1 -> "/", ~0 -> "~" (order matters).
		seg = strings.ReplaceAll(strings.ReplaceAll(seg, "~1", "/"), "~0", "~")
		switch node := cur.(type) {
		case map[string]any:
			v, ok := node[seg]
			if !ok {
				return nil, false
			}
			cur = v
		case []any:
			i, err := strconv.Atoi(seg)
			if err != nil || i < 0 || i >= len(node) {
				return nil, false
			}
			cur = node[i]
		default:
			return nil, false
		}
	}
	return cur, true
}

// scalarString renders a JSON/YAML scalar as a string; ok is false for
// composite values (maps, arrays) and nil.
func scalarString(v any) (string, bool) {
	switch x := v.(type) {
	case string:
		return x, true
	case bool:
		return strconv.FormatBool(x), true
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64), true
	case int:
		return strconv.Itoa(x), true
	case int64:
		return strconv.FormatInt(x, 10), true
	case json.Number:
		return x.String(), true
	default:
		return "", false
	}
}
