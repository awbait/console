package catalog

import (
	"reflect"
	"testing"
)

// Helm lays a chart's defaults underneath the values it was given, and the
// portal has to lay them the same way - or it starts accepting orders Helm
// refuses, which is worse than the strictness it replaces.
func TestCoalesce(t *testing.T) {
	for name, c := range map[string]struct {
		values, defaults, want map[string]any
	}{
		"a default nobody overrode comes through": {
			values:   map[string]any{"a": 1},
			defaults: map[string]any{"b": 2},
			want:     map[string]any{"a": 1, "b": 2},
		},
		"the value wins": {
			values:   map[string]any{"a": 1},
			defaults: map[string]any{"a": 2},
			want:     map[string]any{"a": 1},
		},
		"maps merge key by key": {
			values:   map[string]any{"m": map[string]any{"a": 1}},
			defaults: map[string]any{"m": map[string]any{"a": 9, "b": 2}},
			want:     map[string]any{"m": map[string]any{"a": 1, "b": 2}},
		},
		"deeply": {
			values:   map[string]any{"m": map[string]any{"n": map[string]any{"a": 1}}},
			defaults: map[string]any{"m": map[string]any{"n": map[string]any{"b": 2}}},
			want:     map[string]any{"m": map[string]any{"n": map[string]any{"a": 1, "b": 2}}},
		},
		// The one that matters most. Helm replaces a list, it does not join one,
		// and a portal that joined them would pass values Helm then refuses.
		"a list is replaced, not joined": {
			values:   map[string]any{"l": []any{1}},
			defaults: map[string]any{"l": []any{1, 2, 3}},
			want:     map[string]any{"l": []any{1}},
		},
		"a list replaces a default map, and a map a default list": {
			values:   map[string]any{"a": []any{1}, "b": map[string]any{"x": 1}},
			defaults: map[string]any{"a": map[string]any{"x": 1}, "b": []any{1}},
			want:     map[string]any{"a": []any{1}, "b": map[string]any{"x": 1}},
		},
		// Helm reads an explicit null as "not this one".
		"null drops the default underneath": {
			values:   map[string]any{"a": nil, "b": 1},
			defaults: map[string]any{"a": "gone", "b": 2},
			want:     map[string]any{"b": 1},
		},
		"an empty value keeps every default": {
			values:   map[string]any{},
			defaults: map[string]any{"a": 1},
			want:     map[string]any{"a": 1},
		},
		"no defaults at all changes nothing": {
			values:   map[string]any{"a": 1},
			defaults: map[string]any{},
			want:     map[string]any{"a": 1},
		},
		// An empty string, a zero and a false are answers, not absences.
		"a falsy value is still a value": {
			values:   map[string]any{"a": "", "b": 0, "c": false},
			defaults: map[string]any{"a": "x", "b": 9, "c": true},
			want:     map[string]any{"a": "", "b": 0, "c": false},
		},
	} {
		if got := Coalesce(c.values, c.defaults); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s:\n got %#v\nwant %#v", name, got, c.want)
		}
	}
}

// The merge is for the check alone, so it must not reach back into what the
// caller holds: the order's own values are what gets written to Git.
func TestCoalesceLeavesItsInputsAlone(t *testing.T) {
	values := map[string]any{"m": map[string]any{"a": 1}}
	defaults := map[string]any{"m": map[string]any{"b": 2}, "top": 3}

	Coalesce(values, defaults)

	if !reflect.DeepEqual(values, map[string]any{"m": map[string]any{"a": 1}}) {
		t.Errorf("the values were changed: %#v", values)
	}
	if !reflect.DeepEqual(defaults, map[string]any{"m": map[string]any{"b": 2}, "top": 3}) {
		t.Errorf("the defaults were changed: %#v", defaults)
	}
}
