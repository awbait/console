package views

import (
	"encoding/json"
	"sort"
)

// The "initial" block: values a NEW order form opens with, filled in and
// editable.
//
// It is the counterpart of "defaults", and the difference is the whole point of
// having two blocks. A default is stamped by the portal when an order is saved,
// over whatever the form sent, so it suits a field nobody is meant to touch. An
// initial value is put into the form before a person starts filling it in, and
// what they do with it afterwards is theirs: they may change it, and the change
// is what gets saved.
//
// Which is why a value written in "defaults" is not a prefill: the form never
// sees it, and a person typing into such a field would have their input quietly
// overwritten on save.
//
// It only applies to a new order. Re-seeding an existing one would overwrite
// somebody's edit with a value they had already decided against.

// Initial returns the "initial" block of a view document: a map from an RFC6901
// JSON pointer to the value the order form starts with. Nil when the block is
// absent or malformed.
func Initial(viewJSON []byte) map[string]any {
	var doc struct {
		Initial map[string]any `json:"initial"`
	}
	if err := json.Unmarshal(viewJSON, &doc); err != nil {
		return nil
	}
	return doc.Initial
}

// RenderInitial builds the values a new order form starts with: a fresh map with
// every pointer of the "initial" block set to its rendered value.
//
// The data it renders against is only what an unfilled form knows - the team,
// the chart, the person opening it, the platform variables. Anything else is
// still being typed, which is why checkInitial refuses a document that asks for
// it rather than letting it render as an empty string here.
func RenderInitial(viewJSON []byte, data TemplateData, schemaJSON []byte) (map[string]any, error) {
	initial := Initial(viewJSON)
	if len(initial) == 0 {
		return map[string]any{}, nil
	}
	schema := parseSchema(schemaJSON)
	values := map[string]any{}
	ptrs := make([]string, 0, len(initial))
	for ptr := range initial {
		ptrs = append(ptrs, ptr)
	}
	sort.Strings(ptrs)
	for _, ptr := range ptrs {
		val, err := renderValue(initial[ptr], ptr, data, schema)
		if err != nil {
			return values, err
		}
		setPointer(values, ptr, val)
	}
	return values, nil
}
