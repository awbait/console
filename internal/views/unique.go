package views

// Names that must not repeat inside a list.
//
// A chart builds the name of a resource out of the name of a list entry: a route
// is named after its entry, and so are a listener, a certificate, an external
// service. Two entries sharing a name therefore ask for one resource twice. The
// luckier charts stop rendering and say so; the rest quietly deploy one resource
// where two were ordered, and the second entry is simply gone.
//
// The chart's own values.schema.json cannot say this. JSON Schema has
// uniqueItems, but it compares whole entries, and two routes with one name and
// different rules are not equal entries - the schema is right to accept them,
// because it describes the shape of values, not the fact that a field of an
// entry also addresses something in a cluster.
//
// So the chart says it in its view, on the list itself:
//
//	"overrides": { "xroutes": { "ui:uniqueBy": "name" } }
//
// The portal stays chart-agnostic: it does not know what a route is, only that
// entries of this list are told apart by that field.

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// uniqueByKey is how a view marks the field that tells entries of a list apart.
const uniqueByKey = "ui:uniqueBy"

// UniqueRule is one list and the field its entries are known by.
type UniqueRule struct {
	// Field is the list, named the way a view names fields: a key of the order's
	// values, or a path into a chart dependency ("pooler/items").
	Field string
	// By is the property of an entry that must not repeat.
	By string
}

// UniqueRules returns everything a view document says about repeated names.
//
// Two places declare it, because entries are added in two places. A tab of the
// service card says it on the tab, next to the list it edits - that is where a
// route or an external service is added. A list drawn on the order form itself
// says it in the view's override of that list.
//
// Every view is read, not only "order": the rule is about the values, and the
// values are the same whichever screen wrote them.
func UniqueRules(viewJSON []byte) []UniqueRule {
	var doc struct {
		Views map[string]struct {
			Overrides map[string]map[string]any `json:"overrides"`
		} `json:"views"`
		Tabs []map[string]any `json:"tabs"`
	}
	if err := json.Unmarshal(viewJSON, &doc); err != nil {
		return nil
	}
	seen := map[UniqueRule]bool{}
	var out []UniqueRule
	add := func(field, by string) {
		if field == "" || by == "" {
			return
		}
		rule := UniqueRule{Field: field, By: by}
		if seen[rule] {
			return
		}
		seen[rule] = true
		out = append(out, rule)
	}
	for _, view := range doc.Views {
		for field, ov := range view.Overrides {
			by, _ := ov[uniqueByKey].(string)
			add(field, by)
		}
	}
	for _, tab := range doc.Tabs {
		by, _ := tab[uniqueByKey].(string)
		// A tab names its list as a JSON pointer ("/xroutes"); a view override
		// names a field ("xroutes", or "pooler/items" through a dependency). Both
		// walk the same way once the pointer sheds its leading slash.
		items, _ := tab["items"].(string)
		add(strings.TrimPrefix(items, "/"), by)
	}
	return out
}

// Duplicate is a name found twice in one list: which list, which field of an
// entry, the value itself and the position of the second entry carrying it.
type Duplicate struct {
	Field string
	By    string
	Value string
	Index int
}

// FindDuplicate returns the first repeated name in values, or ok=false when
// every list obeys its rule.
//
// The first, not all of them: the person fixes one and asks again, and a list of
// every collision at once reads as a wall in front of a form that is otherwise
// filled in correctly.
func FindDuplicate(values map[string]any, rules []UniqueRule) (Duplicate, bool) {
	for _, rule := range rules {
		list, ok := resolveList(values, rule.Field)
		if !ok {
			continue
		}
		seen := map[string]bool{}
		for i, entry := range list {
			m, isMap := entry.(map[string]any)
			if !isMap {
				continue
			}
			name, isString := m[rule.By].(string)
			if !isString || name == "" {
				continue
			}
			if seen[name] {
				return Duplicate{Field: rule.Field, By: rule.By, Value: name, Index: i}, true
			}
			seen[name] = true
		}
	}
	return Duplicate{}, false
}

// resolveList walks a field name down to the list it points at.
//
// A name may be a path through a chart dependency, the way a view names any
// other field of one, and it may step through a list on the way: a tab names
// the listeners of the first gateway as "/gateways/0/listeners", because a chart
// that provisions one gateway keeps it at a fixed place.
func resolveList(values map[string]any, field string) ([]any, bool) {
	var node any = values
	for seg := range strings.SplitSeq(field, "/") {
		if i, err := strconv.Atoi(seg); err == nil {
			list, ok := node.([]any)
			if !ok || i < 0 || i >= len(list) {
				return nil, false
			}
			node = list[i]
			continue
		}
		m, ok := node.(map[string]any)
		if !ok {
			return nil, false
		}
		node, ok = m[seg]
		if !ok {
			return nil, false
		}
	}
	list, ok := node.([]any)
	return list, ok
}

// DuplicateMessage is what the person is told, in the wording the order form
// uses for a name already in use.
func DuplicateMessage(d Duplicate) string {
	return fmt.Sprintf("Имя «%s» уже занято. Дайте этой записи другое имя.", d.Value)
}
