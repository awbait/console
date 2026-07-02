package views

import "encoding/json"

// OrderNamespace returns the JSON pointer declared as views.order.namespace, the
// values field that holds the namespace a chart provisions for itself (e.g.
// managed-namespace: "/namespace/namespaceName"). Returns "" when absent or
// malformed.
//
// A chart that creates its own namespace names it through a value rather than
// deploying into a pre-existing one. Declaring the pointer lets the portal mirror
// the order's destination namespace into that value, so the chart renders into
// the namespace it creates (no separate input, no chart-specific code).
func OrderNamespace(viewJSON []byte) string {
	var doc struct {
		Views map[string]struct {
			Namespace string `json:"namespace"`
		} `json:"views"`
	}
	if err := json.Unmarshal(viewJSON, &doc); err != nil {
		return ""
	}
	return doc.Views["order"].Namespace
}

// BindNamespace mirrors namespace into the values field named by the view's
// order.namespace pointer, OVERWRITING any value already there. It is a no-op
// when the view declares no pointer or namespace is empty. Returns the (mutated)
// values map. See setPointer for the object-only addressing semantics.
//
// Only the legacy string form of order.namespace declares a mirror pointer; the
// object form (NamespaceRule) is not a string, so OrderNamespace returns "" and
// this is a no-op - the object form drives destination.namespace instead of
// mirroring into values (see ResolveDestinationNamespace).
func BindNamespace(values map[string]any, viewJSON []byte, namespace string) map[string]any {
	ptr := OrderNamespace(viewJSON)
	if ptr == "" || namespace == "" {
		return values
	}
	if values == nil {
		values = map[string]any{}
	}
	setPointer(values, ptr, namespace)
	return values
}

// Namespace directive sources: where an order's ArgoCD destination.namespace
// comes from. ArgoCD always requires a destination namespace, so the portal must
// always resolve one; the source only decides from where.
const (
	NamespaceSourceField  = "field"  // the order form's Namespace input (default)
	NamespaceSourceValues = "values" // a values field the chart names itself by
	NamespaceSourceFixed  = "fixed"  // a constant declared in the view
)

// NamespaceRule is the parsed views.order.namespace directive. It declares where
// destination.namespace comes from and whether the order form still shows a
// Namespace input. The zero value means "field, shown" - the default behaviour.
type NamespaceRule struct {
	Source         string // one of NamespaceSource*; "" is treated as field
	Pointer        string // source=values: values field holding the namespace
	Value          string // source=fixed: the literal namespace
	HideOrderField bool   // hide the order form's Namespace input
}

// OrderNamespaceRule parses views.order.namespace, accepting both forms:
//   - string "/ptr" (legacy): a mirror - the order namespace is copied INTO the
//     values field (see BindNamespace). Equivalent here to source=field, so
//     destination.namespace still comes from the form field.
//   - object {source, pointer, value, hideOrderField}: the general directive.
//
// A missing or malformed directive returns the zero value (source=field, field
// shown), so charts that declare nothing keep today's behaviour.
func OrderNamespaceRule(viewJSON []byte) NamespaceRule {
	var doc struct {
		Views map[string]struct {
			Namespace json.RawMessage `json:"namespace"`
		} `json:"views"`
	}
	if err := json.Unmarshal(viewJSON, &doc); err != nil {
		return NamespaceRule{}
	}
	raw := doc.Views["order"].Namespace
	if len(raw) == 0 {
		return NamespaceRule{}
	}
	// Legacy string form: destination stays the form field (a mirror pointer,
	// applied separately by BindNamespace).
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return NamespaceRule{Source: NamespaceSourceField}
	}
	var obj struct {
		Source         string `json:"source"`
		Pointer        string `json:"pointer"`
		Value          string `json:"value"`
		HideOrderField bool   `json:"hideOrderField"`
	}
	if err := json.Unmarshal(raw, &obj); err != nil {
		return NamespaceRule{}
	}
	if obj.Source == "" {
		obj.Source = NamespaceSourceField
	}
	return NamespaceRule{
		Source:         obj.Source,
		Pointer:        obj.Pointer,
		Value:          obj.Value,
		HideOrderField: obj.HideOrderField,
	}
}

// ResolveDestinationNamespace computes the ArgoCD destination namespace from the
// rule. orderNamespace is what the user typed in the order form (source=field);
// values are the order's decoded values (source=values). Returns "" when the
// source yields nothing, so the caller can fall back to a default (service_name)
// - destination.namespace must never be empty.
func ResolveDestinationNamespace(rule NamespaceRule, orderNamespace string, values map[string]any) string {
	switch rule.Source {
	case NamespaceSourceValues:
		if v, ok := ResolvePointer(values, rule.Pointer); ok {
			return v
		}
		return ""
	case NamespaceSourceFixed:
		return rule.Value
	default: // field (and the empty/default case)
		return orderNamespace
	}
}
