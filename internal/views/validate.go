// Package views validates chart publication view documents: the format
// structure (views.* with include/exclude/overrides/identity/namespace, plus
// optional tabs/actions/defaults) and, when the chart's values.schema.json is present,
// references to real schema fields. The chart schema stays the single source of
// truth; a view only projects its fields. The "defaults" block additionally
// lets a chart declare order-time values the portal stamps in (see Defaults /
// ApplyDefaults in defaults.go).
//
// The format itself is described once, in document.schema.json, and checked by
// checkShape (schema.go). What is left here is what a static schema cannot say:
// whether a pointer finds a field in THIS chart's values.schema.json, whether a
// tab id is free, whether a form a tab names exists, and the graph directive,
// whose allowed keys come from a profile the portal implements.
package views

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"unicode"
)

// Issue is a single validation problem; Path points into the view document
// (JSON pointer), and for schema reference errors, to the referencing field.
type Issue struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

// ValidateStructure checks only the document format (without the chart schema).
func ValidateStructure(viewJSON []byte, options ...Option) []Issue {
	return Validate(viewJSON, nil, options...)
}

// Option narrows what Validate is able to say. Everything it turns on is
// knowledge the views package cannot have on its own and the caller does.
type Option func(*opts)

type opts struct{ vars KnownVars }

// WithVariables tells the checker which platform variables exist, so a
// "{{.Vars.OPS}}" naming one that does not is caught while the document is being
// written instead of when somebody orders the service. Without it such a
// reference is only checked for shape. An empty list means there are none.
func WithVariables(names []string) Option {
	return func(o *opts) {
		set := make(KnownVars, len(names))
		for _, n := range names {
			set[n] = true
		}
		o.vars = set
	}
}

// Validate checks the view document. When schemaJSON is non-empty, it also
// cross-checks include/exclude/overrides/identity against values.schema.json
// fields (an unknown schema structure is skipped silently, we check only what
// we can prove).
func Validate(viewJSON, schemaJSON []byte, options ...Option) []Issue {
	var o opts
	for _, apply := range options {
		apply(&o)
	}
	var doc map[string]any
	if err := json.Unmarshal(viewJSON, &doc); err != nil {
		return []Issue{{Path: "", Message: "Невалидный JSON: " + err.Error()}}
	}
	// json.Unmarshal silently collapses duplicate keys (a second "order"
	// would overwrite the first), so we catch them with a token scan before
	// the substantive checks.
	issues := duplicateKeys(viewJSON)
	issues = append(issues, checkShape(doc)...)

	var schema map[string]any
	if len(schemaJSON) > 0 {
		// A broken chart schema is not blamed on the view document, just no cross-checks.
		_ = json.Unmarshal(schemaJSON, &schema)
	}
	viewsMap, _ := doc["views"].(map[string]any)
	tabsArr, _ := doc["tabs"].([]any)

	// Forms used by a tab as its form project the ELEMENT of the items array, not
	// the schema root, so their include/exclude are checked against element fields.
	formNode := map[string]map[string]any{}
	if schema != nil {
		for _, it := range tabsArr {
			m, _ := it.(map[string]any)
			form, _ := m["form"].(string)
			items, _ := m["items"].(string)
			if form == "" || items == "" {
				continue
			}
			if arr := resolvePointerNode(items, schema, schema); arr != nil {
				formNode[form] = itemNode(arr, schema)
			}
		}
	}

	for name, v := range viewsMap {
		vm, ok := v.(map[string]any)
		if !ok {
			continue
		}
		node := schema
		if n, ok := formNode[name]; ok {
			node = n // tab element form: check against array element fields
		}
		issues = append(issues, checkView("/views/"+name, vm, node, schema)...)
	}

	// tabs: product tabs (list tables). Returns the set of tab ids that
	// actions can reference via "tab:<id>".
	tabIssues, tabIDs := checkTabs(tabsArr, viewsMap, schema)
	issues = append(issues, tabIssues...)

	// actions: placement of a view form in the "Actions" menu (info or tab:<id>).
	if actions, ok := doc["actions"].([]any); ok {
		issues = append(issues, checkActions(actions, viewsMap, tabIDs)...)
	}

	// defaults: values the portal stamps into an order at create/update time.
	// Checked even without the chart schema: the templates inside are the
	// document's own business, and a broken one has to be caught here rather
	// than by the first person who orders the service.
	if defaults, ok := doc["defaults"].(map[string]any); ok {
		issues = append(issues, checkDefaults(defaults, schema, o.vars)...)
	}

	// graph: the visual values editor this version turns on, and where its
	// fields live in the values.
	if graph, ok := doc["graph"].(map[string]any); ok {
		issues = append(issues, checkGraph(graph, schema)...)
	}
	return issues
}

// checkDefaults checks the "defaults" block on both sides: the pointer it
// writes to must find a field in values.schema.json (skipped when the chart
// schema is not at hand), and the value, when it references what the portal
// knows about an order, must reference something that exists.
func checkDefaults(m map[string]any, schema map[string]any, vars KnownVars) []Issue {
	var issues []Issue
	for _, ptr := range sortedKeys(m) {
		if !strings.HasPrefix(ptr, "/") {
			continue // the schema already said the key is not a pointer
		}
		if schema != nil && !pointerResolves(ptr, schema, schema) {
			issues = append(issues, Issue{"/defaults" + ptr,
				fmt.Sprintf("Путь %q не находит поле в values.schema.json", ptr)})
		}
		s, ok := m[ptr].(string)
		if !ok {
			continue // the schema already said the value is a scalar
		}
		if err := CheckTemplate(s, vars); err != nil {
			issues = append(issues, Issue{"/defaults" + ptr, upperFirst(err.Error())})
		}
	}
	return issues
}

// sortedKeys keeps the order of complaints stable: two runs over the same
// document have to name the same problem first.
func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// upperFirst capitalizes a message that is a sentence on its own here, but a
// clause when the same error is shown next to the order it refused.
func upperFirst(s string) string {
	r := []rune(s)
	if len(r) == 0 {
		return s
	}
	return string(unicode.ToUpper(r[0])) + string(r[1:])
}

// checkTabs cross-checks product tabs: that ids are free and unique, that the
// form each tab names exists in "views", and that its pointers find something in
// the chart. Returns the set of tab ids, which actions reference as "tab:<id>".
func checkTabs(arr []any, viewsMap, schema map[string]any) ([]Issue, map[string]bool) {
	ids := map[string]bool{}
	reserved := map[string]bool{"info": true, "history": true, "order": true}
	var issues []Issue
	for i, it := range arr {
		p := fmt.Sprintf("/tabs/%d", i)
		m, ok := it.(map[string]any)
		if !ok {
			continue
		}
		id, _ := m["id"].(string)
		switch {
		case id == "":
		case reserved[id]:
			issues = append(issues, Issue{p + "/id", fmt.Sprintf("Id %q зарезервирован (info/history/order)", id)})
		case ids[id]:
			issues = append(issues, Issue{p + "/id", fmt.Sprintf("Вкладка с id %q уже есть", id)})
		default:
			ids[id] = true
		}
		items, _ := m["items"].(string)
		if strings.HasPrefix(items, "/") && schema != nil && !pointerResolves(items, schema, schema) {
			issues = append(issues, Issue{p + "/items", fmt.Sprintf("Путь %q не находит массив в values.schema.json", items)})
		}
		switch form, _ := m["form"].(string); form {
		case "":
		case "order":
			issues = append(issues, Issue{p + "/form", `View "order" это форма заказа, она не подходит как форма элемента`})
		default:
			if _, ok := viewsMap[form]; !ok {
				issues = append(issues, Issue{p + "/form", fmt.Sprintf("View %q нет в блоке \"views\"", form)})
			}
		}
		if t, ok := m["ui:table"].([]any); ok {
			// Resolve the list element schema so column paths can be cross-checked
			// against it (items points at the array; a column path is relative to
			// one element). nil when the schema is absent or items is unresolved -
			// then path checks are skipped, mirroring the other "cannot prove" cases.
			var elem map[string]any
			if schema != nil && strings.HasPrefix(items, "/") {
				if arr := resolvePointerNode(items, schema, schema); arr != nil {
					elem = itemNode(arr, schema)
				}
			}
			issues = append(issues, checkColumns(p+"/ui:table", t, elem, schema)...)
		}
		if e, ok := m["enums"].([]any); ok && schema != nil {
			issues = append(issues, checkEnums(p+"/enums", e, schema)...)
		}
	}
	return issues, ids
}

// checkEnums cross-checks the source array of every dynamic enum rule.
func checkEnums(path string, arr []any, schema map[string]any) []Issue {
	var issues []Issue
	for i, it := range arr {
		m, ok := it.(map[string]any)
		if !ok {
			continue
		}
		from, _ := m["from"].(string)
		if strings.HasPrefix(from, "/") && !pointerResolves(from, schema, schema) {
			issues = append(issues, Issue{fmt.Sprintf("%s/%d/from", path, i),
				fmt.Sprintf("Путь %q не находит массив в values.schema.json", from)})
		}
	}
	return issues
}

// checkActions cross-checks that every action names a form that exists and a
// place that exists: "info" (the "General info" tab) or a tab from "tabs".
func checkActions(arr []any, viewsMap map[string]any, tabIDs map[string]bool) []Issue {
	var issues []Issue
	for i, it := range arr {
		p := fmt.Sprintf("/actions/%d", i)
		m, ok := it.(map[string]any)
		if !ok {
			continue
		}
		switch view, _ := m["view"].(string); view {
		case "":
		case "order":
			issues = append(issues, Issue{p + "/view", `View "order" это форма заказа, её нельзя класть в «Действия»`})
		default:
			if _, ok := viewsMap[view]; !ok {
				issues = append(issues, Issue{p + "/view", fmt.Sprintf("View %q нет в блоке \"views\"", view)})
			}
		}
		if in, _ := m["in"].(string); strings.HasPrefix(in, "tab:") {
			if tab := strings.TrimPrefix(in, "tab:"); tab != "" && !tabIDs[tab] {
				issues = append(issues, Issue{p + "/in", fmt.Sprintf("Вкладки %q нет в блоке \"tabs\"", tab)})
			}
		}
	}
	return issues
}

// checkView cross-checks one view (or a nested ui:view) against a schema node:
// every field it names has to exist there. node is the schema node whose fields
// the view references (nil = cannot check).
func checkView(path string, vm map[string]any, node, root map[string]any) []Issue {
	var issues []Issue
	props := collectProperties(node, root)

	for _, key := range []string{"include", "exclude", "required"} {
		list, _ := vm[key].([]any)
		for i, item := range list {
			s, ok := item.(string)
			if !ok || props == nil || props[s] != nil {
				continue
			}
			issues = append(issues, Issue{fmt.Sprintf("%s/%s/%d", path, key, i),
				fmt.Sprintf("Definition %q не найден в values.schema.json. Сверьтесь со вкладкой схемы", s)})
		}
	}

	if s, ok := vm["identity"].(string); ok && strings.HasPrefix(s, "/") && node != nil && !pointerResolves(s, node, root) {
		issues = append(issues, Issue{path + "/identity",
			fmt.Sprintf("Указатель %q не находит поле в values.schema.json. Проверьте путь", s)})
	}

	// "namespace" declares where the order's ArgoCD destination namespace comes
	// from. Two forms: a plain pointer (the order namespace is mirrored into that
	// values field) and {source, pointer, value, hideOrderField}, where
	// source=values names the field the chart itself is named by. Both point into
	// the chart, which is the half a static schema cannot check.
	switch nv := vm["namespace"].(type) {
	case string:
		if strings.HasPrefix(nv, "/") && node != nil && !pointerResolves(nv, node, root) {
			issues = append(issues, Issue{path + "/namespace",
				fmt.Sprintf("Указатель %q не находит поле в values.schema.json. Проверьте путь", nv)})
		}
	case map[string]any:
		ptr, _ := nv["pointer"].(string)
		if strings.HasPrefix(ptr, "/") && node != nil && !pointerResolves(ptr, node, root) {
			issues = append(issues, Issue{path + "/namespace/pointer",
				fmt.Sprintf("Указатель %q не находит поле в values.schema.json. Проверьте путь", ptr)})
		}
	}

	overrides, _ := vm["overrides"].(map[string]any)
	for field, ov := range overrides {
		fp := path + "/overrides/" + field
		var fieldNode map[string]any
		if props != nil {
			if props[field] == nil {
				issues = append(issues, Issue{fp,
					fmt.Sprintf("Definition %q не найден в values.schema.json. Сверьтесь со вкладкой схемы", field)})
			} else {
				fieldNode, _ = props[field].(map[string]any)
			}
		}
		ovm, ok := ov.(map[string]any)
		if !ok {
			continue
		}
		if nested, ok := ovm["ui:view"].(map[string]any); ok {
			// A nested ui:view applies to object fields; for an array,
			// to the element (an array renders as a list of cards or as single).
			issues = append(issues, checkView(fp+"/ui:view", nested, itemNode(fieldNode, root), root)...)
		}
	}
	return issues
}

// checkColumns cross-checks the column paths of a list tab against the schema of
// one element. A column sets either "path" (a slash path into the element; a "*"
// segment iterates the array at that point, e.g. "from/*/namespace") or "lookup"
// (a value computed through a join by reference).
func checkColumns(path string, arr []any, elem, root map[string]any) []Issue {
	var issues []Issue
	for i, it := range arr {
		m, ok := it.(map[string]any)
		if !ok {
			continue
		}
		if _, ok := m["lookup"]; ok {
			continue // a computed column names arrays elsewhere in the values, not fields of this element
		}
		s, _ := m["path"].(string)
		if s != "" && elem != nil && !tablePathResolves(s, elem, root) {
			issues = append(issues, Issue{fmt.Sprintf("%s/%d/path", path, i),
				fmt.Sprintf("Путь %q не находит поле в элементе списка (values.schema.json). Сверьтесь со вкладкой схемы", s)})
		}
	}
	return issues
}

// duplicateKeys uses a token scan to find repeated keys in document objects
// (json.Unmarshal silently collapses them, losing data).
func duplicateKeys(data []byte) []Issue {
	dec := json.NewDecoder(bytes.NewReader(data))
	var scanValue func(path string) []Issue
	scanValue = func(path string) []Issue {
		t, err := dec.Token()
		if err != nil {
			return nil
		}
		d, ok := t.(json.Delim)
		if !ok {
			return nil // scalar
		}
		var issues []Issue
		switch d {
		case '{':
			seen := map[string]bool{}
			for dec.More() {
				kt, err := dec.Token()
				if err != nil {
					return issues
				}
				key, _ := kt.(string)
				kp := path + "/" + key
				if seen[key] {
					issues = append(issues, Issue{kp,
						fmt.Sprintf("Ключ %q указан дважды, JSON оставит только последнее значение. Уберите дубль", key)})
				}
				seen[key] = true
				issues = append(issues, scanValue(kp)...)
			}
			_, _ = dec.Token() // '}'
		case '[':
			for i := 0; dec.More(); i++ {
				issues = append(issues, scanValue(fmt.Sprintf("%s/%d", path, i))...)
			}
			_, _ = dec.Token() // ']'
		}
		return issues
	}
	return scanValue("")
}

// --- schema navigation ---

// deref resolves a $ref within the schema document (#/definitions/...).
func deref(node, root map[string]any) map[string]any {
	for range 10 { // cycle guard
		ref, _ := node["$ref"].(string)
		if ref == "" || !strings.HasPrefix(ref, "#/") || root == nil {
			return node
		}
		cur := any(root)
		for seg := range strings.SplitSeq(strings.TrimPrefix(ref, "#/"), "/") {
			m, ok := cur.(map[string]any)
			if !ok {
				return node
			}
			cur = m[seg]
		}
		next, ok := cur.(map[string]any)
		if !ok {
			return node
		}
		node = next
	}
	return node
}

// collectProperties gathers a node's merged properties: own + the
// allOf/oneOf/anyOf/then/else branches (fields may live in conditional branches).
// nil if the node is unknown or does not describe an object with properties
// (checks are skipped).
func collectProperties(node, root map[string]any) map[string]any {
	if node == nil {
		return nil
	}
	node = deref(node, root)
	out := map[string]any{}
	var walk func(n map[string]any)
	walk = func(n map[string]any) {
		n = deref(n, root)
		if props, ok := n["properties"].(map[string]any); ok {
			for k, v := range props {
				if _, dup := out[k]; !dup {
					out[k] = v
				}
			}
		}
		for _, branchKey := range []string{"allOf", "oneOf", "anyOf"} {
			if list, ok := n[branchKey].([]any); ok {
				for _, b := range list {
					if bm, ok := b.(map[string]any); ok {
						walk(bm)
					}
				}
			}
		}
		for _, branchKey := range []string{"then", "else"} {
			if bm, ok := n[branchKey].(map[string]any); ok {
				walk(bm)
			}
		}
	}
	walk(node)
	if len(out) == 0 {
		return nil
	}
	return out
}

// itemNode returns the node whose fields a nested ui:view applies to: for an
// array, items (the view describes one element), otherwise the node itself.
func itemNode(node, root map[string]any) map[string]any {
	if node == nil {
		return nil
	}
	node = deref(node, root)
	if t, _ := node["type"].(string); t == "array" {
		items, _ := node["items"].(map[string]any)
		if items == nil {
			return nil
		}
		return deref(items, root)
	}
	return node
}

// pointerResolves checks that a JSON pointer over values (for example
// /gateways/0/name) finds a field in the schema: a numeric segment steps into
// items, others into properties. Unknown parts of the schema count as a match
// (the error cannot be proven).
func pointerResolves(ptr string, node, root map[string]any) bool {
	cur := deref(node, root)
	for seg := range strings.SplitSeq(strings.TrimPrefix(ptr, "/"), "/") {
		if cur == nil {
			return true // schema not described further, do not blame
		}
		if isIndex(seg) {
			if t, _ := cur["type"].(string); t != "" && t != "array" {
				return false
			}
			items, _ := cur["items"].(map[string]any)
			if items == nil {
				return true
			}
			cur = deref(items, root)
			continue
		}
		props := collectProperties(cur, root)
		if props == nil {
			return true // free-form object
		}
		next, ok := props[seg].(map[string]any)
		if !ok {
			return false
		}
		cur = deref(next, root)
	}
	return true
}

// tablePathResolves checks a ui:table column path against the list element
// schema. Unlike a JSON pointer it has no leading slash and is relative to one
// element. Segments: "*"/"*val" iterate an array's items or a string-keyed map's
// values, "*key" a map's keys, a number picks one element (positional), a name
// reads a property. E.g. "from/*/namespace", "selector/*/weight",
// "selector/*key", "selector/*val/0". Unknown/free-form parts count as a match,
// mirroring pointerResolves: only a path we can prove wrong is flagged.
func tablePathResolves(p string, elem, root map[string]any) bool {
	cur := deref(elem, root)
	for seg := range strings.SplitSeq(p, "/") {
		if cur == nil {
			return true // schema not described further, do not blame
		}
		switch {
		case seg == "*key":
			// Keys of a string-keyed map; meaningful only on an object. The keys
			// are terminal strings, so any following segment cannot resolve.
			if t, _ := cur["type"].(string); t != "" && t != "object" {
				return false
			}
			cur = nil
		case seg == "*" || seg == "*val":
			// Iterate an array's items or a map's value schema.
			if items, ok := cur["items"].(map[string]any); ok {
				cur = deref(items, root)
			} else if ap, ok := cur["additionalProperties"].(map[string]any); ok {
				cur = deref(ap, root)
			} else if t, _ := cur["type"].(string); t != "" && t != "array" && t != "object" {
				return false // a described scalar cannot be iterated
			} else {
				cur = nil // array w/o items, free-form map, or undescribed
			}
		case isIndex(seg):
			// Positional pick: into an array's element, else the same-typed item
			// of a collected list (type unchanged).
			if items, ok := cur["items"].(map[string]any); ok {
				cur = deref(items, root)
			}
		default:
			props := collectProperties(cur, root)
			if props == nil {
				return true // free-form object
			}
			next, ok := props[seg].(map[string]any)
			if !ok {
				return false
			}
			cur = deref(next, root)
		}
	}
	return true
}

// resolvePointerNode returns the schema node a JSON pointer over values points
// to (for example /gateways/0/listeners, the listeners array node), or nil if
// the path is not found or the schema is not described further.
func resolvePointerNode(ptr string, node, root map[string]any) map[string]any {
	cur := deref(node, root)
	for seg := range strings.SplitSeq(strings.TrimPrefix(ptr, "/"), "/") {
		if cur == nil {
			return nil
		}
		if isIndex(seg) {
			items, _ := cur["items"].(map[string]any)
			if items == nil {
				return nil
			}
			cur = deref(items, root)
			continue
		}
		props := collectProperties(cur, root)
		if props == nil {
			return nil
		}
		next, ok := props[seg].(map[string]any)
		if !ok {
			return nil
		}
		cur = deref(next, root)
	}
	return cur
}

func isIndex(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}
