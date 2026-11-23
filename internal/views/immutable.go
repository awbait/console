package views

import (
	"encoding/json"
	"reflect"
	"sort"
	"strconv"
	"strings"
)

// Fields a live order may not change.
//
// An order is created once and then edited many times, and a few of its fields
// are not settings at all: they are what the order is. The field a view names
// as the identity is how the portal tells this instance from its neighbours in
// a namespace, the fields a namespace is built from decide where the service
// runs, and a field marked "ui:readOnly" in the view or the chart schema is one
// the chart builds something immutable out of (the name of a resource, a volume
// claim). The forms lock all of them once the order exists, but a form is not
// the only way in: the values can be edited as YAML, and the API takes whatever
// it is sent. So the rule lives here too, next to the view document it is read
// from.
//
// The portal stays chart-agnostic: which fields these are is the version's own
// document and schema talking.

const readOnlyKey = "ui:readOnly"

// ImmutableRule is one frozen field of a live order.
//
// Path names the field as keys from the root of the values. An explicit index
// segment ("gateways", "0", "name") pins that entry (from views.order.identity,
// views.order.namespace, or a ui:widget="single" list).
//
// When ListPath is non-empty, the rule lives inside the entries of a multi-item
// list whose entries are told apart by UniqueBy (ui:uniqueBy). Surviving
// entries are matched by UniqueBy across before/after so deleting, adding or
// reordering entries keeps working while editing a frozen field on an existing
// entry is refused.
type ImmutableRule struct {
	Path     []string
	ListPath []string
	UniqueBy string
	ItemPath []string
}

// ImmutableRules returns the fields of an order's values that are frozen once
// the order exists, derived from the version's view document and effective
// JSON schema. The returned slice is deterministically ordered.
//
// Sources:
//   - views.order.identity, unless it points into the section a visual editor
//     draws (the graph writes an entry per workload, so its first entry - and
//     the identity read off it - moves with the drawing; the order keeps the
//     name it was created with regardless, see OrderPage.sentName);
//   - the fields the namespace is taken from (source "values") or built from
//     (source "template"); the legacy mirror form is stamped by the portal on
//     every save and needs no rule;
//   - every field marked "ui:readOnly": true in any view override or in the
//     effective schema (unless a view override explicitly clears it with
//     "ui:readOnly": false).
func ImmutableRules(viewJSON, schemaJSON []byte) []ImmutableRule {
	var out []ImmutableRule
	seen := map[string]bool{}
	addFixed := func(path []string) {
		if len(path) == 0 {
			return
		}
		key := "F:" + strings.Join(path, "\x00")
		if seen[key] {
			return
		}
		seen[key] = true
		cp := append([]string{}, path...)
		out = append(out, ImmutableRule{Path: cp})
	}
	addItem := func(listPath []string, uniqueBy string, itemPath []string) {
		if len(listPath) == 0 || uniqueBy == "" || len(itemPath) == 0 {
			return
		}
		// In a declarative YAML edit, deleting an entry named "a" and adding
		// one named "b" produces the same list as renaming "a" to "b". Only
		// non-key fields of surviving entries can be matched by UniqueBy.
		if len(itemPath) == 1 && itemPath[0] == uniqueBy {
			return
		}
		key := "I:" + strings.Join(listPath, "\x00") + "\x01" + uniqueBy + "\x01" + strings.Join(itemPath, "\x00")
		if seen[key] {
			return
		}
		seen[key] = true
		out = append(out, ImmutableRule{
			ListPath: append([]string{}, listPath...),
			UniqueBy: uniqueBy,
			ItemPath: append([]string{}, itemPath...),
		})
	}

	// Map list paths ("xroutes" or "gateways/0/listeners") to their ui:uniqueBy key.
	uniqueByList := map[string]string{}
	for _, r := range UniqueRules(viewJSON) {
		uniqueByList[r.Field] = r.By
	}

	cleared := map[string]bool{}
	singleLists := map[string]bool{}

	if len(viewJSON) > 0 {
		var doc struct {
			Views map[string]json.RawMessage `json:"views"`
			Tabs  []struct {
				Items string `json:"items"`
				Form  string `json:"form"`
			} `json:"tabs"`
		}
		if err := json.Unmarshal(viewJSON, &doc); err == nil {
			if id := OrderIdentity(viewJSON); id != "" {
				graph := ReadGraphMapping(viewJSON)
				if graph == nil || !strings.HasPrefix(id, graph.Entries+"/") {
					addFixed(pointerSegments(id))
				}
			}
			rule := OrderNamespaceRule(viewJSON)
			switch rule.Source {
			case NamespaceSourceValues:
				addFixed(pointerSegments(rule.Pointer))
			case NamespaceSourceTemplate:
				for _, f := range NamespaceTemplateFields(rule.Template) {
					addFixed(f)
				}
			}

			// A view that is the form of a tab's row describes one entry of that list.
			tabLists := map[string][][]string{}
			for _, t := range doc.Tabs {
				if t.Form != "" {
					if segs := pointerSegments(t.Items); len(segs) > 0 {
						tabLists[t.Form] = append(tabLists[t.Form], segs)
					}
				}
			}

			viewNames := make([]string, 0, len(doc.Views))
			for name := range doc.Views {
				viewNames = append(viewNames, name)
			}
			sort.Strings(viewNames)

			for _, name := range viewNames {
				raw := doc.Views[name]
				lists := tabLists[name]
				if len(lists) > 0 {
					for _, listSegs := range lists {
						by := uniqueByList[strings.Join(listSegs, "/")]
						collectTabReadOnly(raw, listSegs, by, nil, addItem, cleared)
					}
					continue
				}
				collectViewReadOnly(raw, nil, uniqueByList, singleLists, addFixed, addItem, cleared)
			}
		}
	}

	if len(schemaJSON) > 0 {
		var schema map[string]any
		if err := json.Unmarshal(schemaJSON, &schema); err == nil && schema != nil {
			collectSchemaReadOnly(schema, schema, nil, uniqueByList, singleLists, cleared, map[string]bool{}, addFixed, addItem)
		}
	}

	sort.Slice(out, func(i, j int) bool {
		return ruleSortKey(out[i]) < ruleSortKey(out[j])
	})
	return out
}

func ruleSortKey(r ImmutableRule) string {
	if len(r.ListPath) > 0 {
		return strings.Join(r.ListPath, ".") + "[]." + strings.Join(r.ItemPath, ".")
	}
	return strings.Join(r.Path, ".")
}

// collectViewReadOnly walks a root-level view's overrides (and nested ui:view
// blocks) for ui:readOnly flags.
func collectViewReadOnly(
	raw json.RawMessage,
	prefix []string,
	uniqueByList map[string]string,
	singleLists map[string]bool,
	addFixed func([]string),
	addItem func([]string, string, []string),
	cleared map[string]bool,
) {
	var view struct {
		Overrides map[string]map[string]json.RawMessage `json:"overrides"`
	}
	if err := json.Unmarshal(raw, &view); err != nil {
		return
	}
	fields := make([]string, 0, len(view.Overrides))
	for f := range view.Overrides {
		fields = append(fields, f)
	}
	sort.Strings(fields)

	for _, field := range fields {
		ov := view.Overrides[field]
		path := append(append([]string{}, prefix...), strings.Split(field, "/")...)
		pathKey := strings.Join(path, "/")
		if b, ok := ov[readOnlyKey]; ok {
			var ro bool
			if json.Unmarshal(b, &ro) == nil {
				if ro {
					addFixed(path)
				} else {
					cleared[pathKey] = true
				}
			}
		}
		var widget string
		if b, ok := ov["ui:widget"]; ok {
			_ = json.Unmarshal(b, &widget)
		}
		if widget == "single" {
			singleLists[pathKey] = true
		}
		if nested, ok := ov["ui:view"]; ok {
			if widget == "single" {
				// ui:widget="single" projects the first item of a list as one form.
				collectViewReadOnly(nested, append(append([]string{}, path...), "0"), uniqueByList, singleLists, addFixed, addItem, cleared)
			} else if by := uniqueByList[pathKey]; by != "" {
				collectTabReadOnly(nested, path, by, nil, addItem, cleared)
			} else {
				collectViewReadOnly(nested, path, uniqueByList, singleLists, addFixed, addItem, cleared)
			}
		}
	}
}

// collectTabReadOnly walks a list-item view (a tab's form or an array's ui:view)
// and records read-only fields scoped to entries matched by uniqueBy.
func collectTabReadOnly(
	raw json.RawMessage,
	listPath []string,
	uniqueBy string,
	itemPrefix []string,
	addItem func([]string, string, []string),
	cleared map[string]bool,
) {
	var view struct {
		Overrides map[string]map[string]json.RawMessage `json:"overrides"`
	}
	if err := json.Unmarshal(raw, &view); err != nil {
		return
	}
	fields := make([]string, 0, len(view.Overrides))
	for f := range view.Overrides {
		fields = append(fields, f)
	}
	sort.Strings(fields)

	listKey := strings.Join(listPath, "/")
	for _, field := range fields {
		ov := view.Overrides[field]
		itemPath := append(append([]string{}, itemPrefix...), strings.Split(field, "/")...)
		clearKey := listKey + "[]/" + strings.Join(itemPath, "/")
		if b, ok := ov[readOnlyKey]; ok {
			var ro bool
			if json.Unmarshal(b, &ro) == nil {
				if ro {
					addItem(listPath, uniqueBy, itemPath)
				} else {
					cleared[clearKey] = true
				}
			}
		}
		if nested, ok := ov["ui:view"]; ok {
			collectTabReadOnly(nested, listPath, uniqueBy, itemPath, addItem, cleared)
		}
	}
}

// collectSchemaReadOnly walks the effective JSON schema for properties marked
// "ui:readOnly": true, honouring explicit "ui:readOnly": false overrides from
// the view document.
func collectSchemaReadOnly(
	node, root map[string]any,
	prefix []string,
	uniqueByList map[string]string,
	singleLists map[string]bool,
	cleared map[string]bool,
	seenRefs map[string]bool,
	addFixed func([]string),
	addItem func([]string, string, []string),
) {
	node, ref := derefSchemaNode(node, root)
	if node == nil {
		return
	}
	if ref != "" {
		if seenRefs[ref] {
			return
		}
		seenRefs[ref] = true
		defer delete(seenRefs, ref)
	}

	if len(prefix) > 0 {
		pathKey := strings.Join(prefix, "/")
		if ro, ok := node[readOnlyKey].(bool); ok && ro && !cleared[pathKey] {
			addFixed(prefix)
			// Locking an object or array locks its entire subtree; no need to descend.
			return
		}
	}

	if props, ok := node["properties"].(map[string]any); ok {
		keys := make([]string, 0, len(props))
		for k := range props {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			child, _ := props[k].(map[string]any)
			if child == nil {
				continue
			}
			collectSchemaReadOnly(child, root, appendPath(prefix, k), uniqueByList, singleLists, cleared, seenRefs, addFixed, addItem)
		}
		return
	}

	if items, ok := node["items"].(map[string]any); ok && len(prefix) > 0 {
		pathKey := strings.Join(prefix, "/")
		if singleLists[pathKey] {
			collectSchemaReadOnly(items, root, appendPath(prefix, "0"), uniqueByList, singleLists, cleared, seenRefs, addFixed, addItem)
			return
		}
		if by := uniqueByList[pathKey]; by != "" {
			collectSchemaItemReadOnly(items, root, prefix, by, nil, cleared, seenRefs, addItem)
		}
	}
}

func collectSchemaItemReadOnly(
	node, root map[string]any,
	listPath []string,
	uniqueBy string,
	itemPrefix []string,
	cleared map[string]bool,
	seenRefs map[string]bool,
	addItem func([]string, string, []string),
) {
	node, ref := derefSchemaNode(node, root)
	if node == nil {
		return
	}
	if ref != "" {
		if seenRefs[ref] {
			return
		}
		seenRefs[ref] = true
		defer delete(seenRefs, ref)
	}
	if len(itemPrefix) > 0 {
		clearKey := strings.Join(listPath, "/") + "[]/" + strings.Join(itemPrefix, "/")
		if ro, ok := node[readOnlyKey].(bool); ok && ro && !cleared[clearKey] {
			addItem(listPath, uniqueBy, itemPrefix)
			return
		}
	}
	if props, ok := node["properties"].(map[string]any); ok {
		keys := make([]string, 0, len(props))
		for k := range props {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			child, _ := props[k].(map[string]any)
			if child == nil {
				continue
			}
			collectSchemaItemReadOnly(child, root, listPath, uniqueBy, appendPath(itemPrefix, k), cleared, seenRefs, addItem)
		}
	}
}

// derefSchemaNode follows a local "$ref" ("#/definitions/...") within root.
func derefSchemaNode(node, root map[string]any) (map[string]any, string) {
	if node == nil {
		return nil, ""
	}
	ref, _ := node["$ref"].(string)
	if ref == "" || !strings.HasPrefix(ref, "#/") {
		return node, ""
	}
	var cur any = root
	for _, seg := range pointerSegments(strings.TrimPrefix(ref, "#")) {
		m, ok := cur.(map[string]any)
		if !ok {
			return node, ""
		}
		cur, ok = m[seg]
		if !ok {
			return node, ""
		}
	}
	target, ok := cur.(map[string]any)
	if !ok {
		return node, ""
	}
	// Keep sibling keywords (like a local ui:readOnly on the referencing property)
	// over the referenced target, matching SchemaForm.deref.
	if len(node) == 1 {
		return target, ref
	}
	merged := make(map[string]any, len(target)+len(node))
	for k, v := range target {
		merged[k] = v
	}
	for k, v := range node {
		if k != "$ref" {
			merged[k] = v
		}
	}
	return merged, ref
}

// pointerSegments splits an RFC6901 pointer into its unescaped keys.
func pointerSegments(pointer string) []string {
	if !strings.HasPrefix(pointer, "/") {
		return nil
	}
	segs := strings.Split(strings.TrimPrefix(pointer, "/"), "/")
	for i, s := range segs {
		segs[i] = strings.ReplaceAll(strings.ReplaceAll(s, "~1", "/"), "~0", "~")
	}
	return segs
}

// FirstImmutableChange reports the first frozen field whose value differs
// between the order as stored (before) and as it is about to be saved
// (after), as a dotted path to the concrete field ("gateways.0.name").
//
// The rule is set-once, the way the forms apply it:
//   - a field the stored order does not have may be filled in;
//   - a list entry the stored order does not have is new, and deleting an entry
//     of a multi-item list is allowed - only surviving entries (matched by
//     UniqueBy) have their frozen fields checked;
//   - a fixed field present before and gone after is a change, unless
//     allowRemoved: an upgrade to another chart version moves fields around,
//     and a field the new version keeps elsewhere is not one the person changed.
func FirstImmutableChange(before, after map[string]any, rules []ImmutableRule, allowRemoved bool) (string, bool) {
	for _, r := range rules {
		if len(r.ListPath) > 0 {
			if at, ok := changedInList(before, after, r, allowRemoved); ok {
				return strings.Join(at, "."), true
			}
			continue
		}
		if at, ok := changedAt(before, after, r.Path, nil, allowRemoved); ok {
			return strings.Join(at, "."), true
		}
	}
	return "", false
}

func changedInList(before, after map[string]any, r ImmutableRule, allowRemoved bool) ([]string, bool) {
	bList, ok := resolveList(before, strings.Join(r.ListPath, "/"))
	if !ok {
		return nil, false
	}
	aList, ok := resolveList(after, strings.Join(r.ListPath, "/"))
	if !ok {
		return nil, false
	}
	byKey := map[string]struct {
		entry map[string]any
		index int
	}{}
	for i, item := range aList {
		m, isMap := item.(map[string]any)
		if !isMap {
			continue
		}
		key, isStr := m[r.UniqueBy].(string)
		if !isStr || key == "" {
			continue
		}
		if _, exists := byKey[key]; !exists {
			byKey[key] = struct {
				entry map[string]any
				index int
			}{entry: m, index: i}
		}
	}
	for _, item := range bList {
		bm, isMap := item.(map[string]any)
		if !isMap {
			continue
		}
		key, isStr := bm[r.UniqueBy].(string)
		if !isStr || key == "" {
			continue
		}
		am, exists := byKey[key]
		if !exists {
			continue // entry was removed
		}
		prefix := append(append([]string{}, r.ListPath...), strconv.Itoa(am.index))
		if got, ok := changedAt(bm, am.entry, r.ItemPath, prefix, allowRemoved); ok {
			return got, true
		}
	}
	return nil, false
}

func changedAt(before, after any, segs, at []string, allowRemoved bool) ([]string, bool) {
	if before == nil {
		return nil, false // nothing was set: set-once lets it be filled
	}
	if len(segs) == 0 {
		if after == nil {
			return at, !allowRemoved
		}
		return at, !reflect.DeepEqual(before, after)
	}
	seg := segs[0]
	switch b := before.(type) {
	case map[string]any:
		bv, ok := b[seg]
		if !ok {
			return nil, false
		}
		var av any
		if a, isMap := after.(map[string]any); isMap {
			av = a[seg]
		}
		return changedAt(bv, av, segs[1:], appendPath(at, seg), allowRemoved)
	case []any:
		i, err := strconv.Atoi(seg)
		if err != nil || i < 0 || i >= len(b) {
			return nil, false
		}
		var av any
		if a, isSlice := after.([]any); isSlice && i < len(a) {
			av = a[i]
		}
		return changedAt(b[i], av, segs[1:], appendPath(at, seg), allowRemoved)
	default:
		return nil, false // a scalar on the way: the path addresses nothing here
	}
}

func appendPath(at []string, seg string) []string {
	return append(append([]string{}, at...), seg)
}
