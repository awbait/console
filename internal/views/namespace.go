package views

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

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
	// The name is built from the order the way the chart builds it: a template
	// over the order's values and context, in the dialect of tmpl.go. It is for
	// a chart that composes the name of its own namespace from several fields
	// (project, cluster, purpose): the formula stays in the chart's document,
	// and the portal lands the order in the namespace that really appears.
	NamespaceSourceTemplate = "template"
)

// NamespaceRule is the parsed views.order.namespace directive. It declares where
// destination.namespace comes from and whether the order form still shows a
// Namespace input. The zero value means "field, shown" - the default behaviour.
type NamespaceRule struct {
	Source         string // one of NamespaceSource*; "" is treated as field
	Pointer        string // source=values: values field holding the namespace
	Value          string // source=fixed: the literal namespace
	Template       string // source=template: the template the name is rendered from
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
		Template       string `json:"template"`
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
		Template:       obj.Template,
		HideOrderField: obj.HideOrderField,
	}
}

// ResolveDestinationNamespace computes the ArgoCD destination namespace from the
// rule. orderNamespace is what the user typed in the order form (source=field);
// values are the order's decoded values (source=values, source=template); data
// is the order's context for source=template. Returns "" when the source yields
// nothing, so the caller can fall back to a default (service_name) -
// destination.namespace must never be empty. The error is a template that could
// not be rendered for this order: it is never swallowed into the fallback,
// because an order named after its service instead of the namespace the chart
// creates is the very mismatch the template exists to remove.
func ResolveDestinationNamespace(rule NamespaceRule, orderNamespace string, values map[string]any, data TemplateData) (string, error) {
	switch rule.Source {
	case NamespaceSourceValues:
		if v, ok := ResolvePointer(values, rule.Pointer); ok {
			return v, nil
		}
		return "", nil
	case NamespaceSourceFixed:
		return rule.Value, nil
	case NamespaceSourceTemplate:
		return RenderNamespaceTemplate(rule.Template, data, values)
	default: // field (and the empty/default case)
		return orderNamespace, nil
	}
}

// What a namespace template says when it cannot be used. Each of the first four
// takes the reference as written, between the braces (open, text, close).
const (
	msgNsValuesWhole    = "«%s%s%s»: укажите поле, из которого брать значение для имени неймспейса, например «{{.Values.global.namespacePurpose}}»"
	msgNsSelf           = "«%s%s%s»: этот шаблон сам вычисляет имя неймспейса, поэтому сослаться на него здесь нельзя"
	msgNsUnknownRef     = "ссылка «%s%s%s» недоступна в шаблоне неймспейса. Используйте доступные ссылки: %s"
	msgNsValueNotScalar = "«%s%s%s»: ссылка указывает на объект или список. Укажите поле со строкой, числом или булевым значением"
	// The one the person ordering reads. Argument: the field, dotted.
	msgNsValueEmpty = "Заполните поле «%s»: из его значения собирается имя неймспейса."
)

// valuesRoot opens a reference to the order's values in a namespace template:
// {{.Values.global.namespacePurpose}}, {{index .Values "my-key" "x"}}.
const valuesRoot = "Values"

func isValuesRef(r tmplRef) bool { return r.path[0] == valuesRoot }

// RenderNamespaceTemplate renders the namespace template of a view document for
// one order. It sees the order's values as the form sent them: the namespace is
// resolved before the "defaults" block is stamped, which is why the validator
// refuses a template that reads a field "defaults" writes.
func RenderNamespaceTemplate(s string, d TemplateData, values map[string]any) (string, error) {
	return walkNamespace(s, func(r tmplRef) (string, error) {
		if err := namespaceScope(r); err != nil {
			return "", err
		}
		if isValuesRef(r) {
			return valueAt(values, r)
		}
		return d.resolve(r.dotted())
	})
}

// CheckNamespaceTemplate is CheckTemplate for the namespace template: the same
// grammar, a scope of its own. Whether a values reference finds a field is the
// chart's half, checked by the validator against values.schema.json.
func CheckNamespaceTemplate(s string, known KnownVars) error {
	_, err := walkNamespace(s, func(r tmplRef) (string, error) {
		if err := namespaceScope(r); err != nil {
			return "", err
		}
		if isValuesRef(r) {
			return "", nil
		}
		return "", checkRef(r.dotted(), known)
	})
	return err
}

// walkNamespace is walkTemplate without the pass-through. A value may carry
// somebody else's template ("{{ $labels.x }}") that has to come out untouched,
// but a namespace name has no such neighbour: any other "{{" in it is a
// condition or a function the dialect does not have, and is named as one.
func walkNamespace(s string, resolve func(r tmplRef) (string, error)) (string, error) {
	for rest := s; ; {
		i := strings.Index(rest, tmplOpen)
		if i < 0 {
			break
		}
		rest = rest[i+len(tmplOpen):]
		if !isOurs(rest) {
			inner, _, _ := strings.Cut(rest, tmplClose)
			return "", fmt.Errorf(MsgTemplateSyntax, tmplOpen, strings.TrimSpace(inner), tmplClose)
		}
	}
	return walkTemplate(s, resolve)
}

// NamespaceTemplateFields lists the values paths a namespace template reads,
// each as its keys from the root ("global", "namespacePurpose"). It is a scan:
// a template that breaks halfway still names what it named before the break.
func NamespaceTemplateFields(s string) [][]string {
	var out [][]string
	_, _ = walkTemplate(s, func(r tmplRef) (string, error) {
		if isValuesRef(r) && len(r.path) > 1 {
			out = append(out, r.path[1:])
		}
		return "", nil
	})
	return out
}

// namespaceScope says whether a reference may be used in a namespace template.
func namespaceScope(r tmplRef) error {
	if isValuesRef(r) {
		if len(r.path) == 1 {
			return fmt.Errorf(msgNsValuesWhole, tmplOpen, r.text, tmplClose)
		}
		return nil
	}
	ref := r.dotted()
	if _, ok := varName(ref); ok {
		return nil
	}
	if ref == ".Namespace" {
		return fmt.Errorf(msgNsSelf, tmplOpen, r.text, tmplClose)
	}
	for _, t := range TemplateRefs() {
		if t.Ref == ref && t.InNamespace {
			return nil
		}
	}
	return fmt.Errorf(msgNsUnknownRef, tmplOpen, r.text, tmplClose, strings.Join(namespaceRefNames(), ", "))
}

// namespaceRefNames is what a namespace template may reference, written out for
// a message: the values, the catalogue entries open to it, the variables.
func namespaceRefNames() []string {
	out := []string{tmplOpen + ".Values.<поле>" + tmplClose}
	for _, t := range TemplateRefs() {
		if t.InNamespace {
			out = append(out, tmplOpen+t.Ref+tmplClose)
		}
	}
	return append(out, tmplOpen+".Vars.<ИМЯ>"+tmplClose)
}

// valueAt reads the field a values reference names. A field that is absent or
// empty is an error, not an empty piece of the name: "nbox--ns-app" is a
// namespace nobody asked for, and the chart would not have built it either.
func valueAt(values map[string]any, r tmplRef) (string, error) {
	var cur any = values
	for _, key := range r.path[1:] {
		m, ok := cur.(map[string]any)
		if !ok {
			cur = nil
			break
		}
		cur = m[key]
	}
	switch v := cur.(type) {
	case nil:
	case string:
		if v != "" {
			return v, nil
		}
	case bool:
		return strconv.FormatBool(v), nil
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64), nil
	case json.Number:
		return v.String(), nil
	case int, int64, uint64:
		return fmt.Sprint(v), nil
	default:
		return "", fmt.Errorf(msgNsValueNotScalar, tmplOpen, r.text, tmplClose)
	}
	return "", &NamespaceValueError{Field: strings.Join(r.path[1:], ".")}
}

// NamespaceValueError is a namespace template that reads a field the order left
// empty. It is a type of its own because it is the one failure the person
// ordering fixes themselves, in the form; the others are the document's.
type NamespaceValueError struct {
	Field string // the field's keys from the root of the values, dotted
}

func (e *NamespaceValueError) Error() string {
	return fmt.Sprintf(msgNsValueEmpty, e.Field)
}
