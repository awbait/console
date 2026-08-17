package provisioning

import (
	"reflect"
	"slices"
	"testing"
)

// vals is a shorthand for a values tree in these tables.
type vals = map[string]any

func TestThreeWayMerge(t *testing.T) {
	cases := []struct {
		name               string
		base, theirs, mine vals
		want               vals
		wantConflicts      []string
	}{
		{
			name: "edits to different fields both survive",
			base: vals{"replicas": 1, "host": "a.local"},
			// The point of the whole exercise: neither person sees the other's
			// change, and neither loses it.
			theirs: vals{"replicas": 2, "host": "a.local"},
			mine:   vals{"replicas": 1, "host": "b.local"},
			want:   vals{"replicas": 2, "host": "b.local"},
		},
		{
			name:          "the same field moved to different values is a conflict",
			base:          vals{"replicas": 1},
			theirs:        vals{"replicas": 2},
			mine:          vals{"replicas": 3},
			want:          vals{"replicas": 2}, // theirs is kept, but the caller must not commit
			wantConflicts: []string{"replicas"},
		},
		{
			name:   "the same field moved to the same value is agreement",
			base:   vals{"replicas": 1},
			theirs: vals{"replicas": 2},
			mine:   vals{"replicas": 2},
			want:   vals{"replicas": 2},
		},
		{
			name:   "untouched fields follow the branch",
			base:   vals{"tls": vals{"enabled": false}},
			theirs: vals{"tls": vals{"enabled": true}},
			mine:   vals{"tls": vals{"enabled": false}},
			want:   vals{"tls": vals{"enabled": true}},
		},
		{
			name:   "nested edits merge field by field",
			base:   vals{"gateway": vals{"port": 80, "host": "a.local"}},
			theirs: vals{"gateway": vals{"port": 443, "host": "a.local"}},
			mine:   vals{"gateway": vals{"port": 80, "host": "b.local"}},
			want:   vals{"gateway": vals{"port": 443, "host": "b.local"}},
		},
		{
			name:          "nested conflicts carry the full path",
			base:          vals{"gateway": vals{"port": 80}},
			theirs:        vals{"gateway": vals{"port": 443}},
			mine:          vals{"gateway": vals{"port": 8080}},
			want:          vals{"gateway": vals{"port": 443}},
			wantConflicts: []string{"gateway.port"},
		},
		{
			name:   "a field this order removed stays removed",
			base:   vals{"replicas": 1, "debug": true},
			theirs: vals{"replicas": 2, "debug": true},
			mine:   vals{"replicas": 1},
			want:   vals{"replicas": 2},
		},
		{
			name:          "removed here, changed there: a person decides",
			base:          vals{"debug": true},
			theirs:        vals{"debug": false},
			mine:          vals{},
			want:          vals{"debug": false},
			wantConflicts: []string{"debug"},
		},
		{
			name:   "a field both sides added identically is not a conflict",
			base:   vals{},
			theirs: vals{"tls": "on"},
			mine:   vals{"tls": "on"},
			want:   vals{"tls": "on"},
		},
		{
			name:          "a field both sides added differently is",
			base:          vals{},
			theirs:        vals{"tls": "on"},
			mine:          vals{"tls": "off"},
			want:          vals{"tls": "on"},
			wantConflicts: []string{"tls"},
		},
		{
			name:   "a list only one side touched is taken whole",
			base:   vals{"hosts": []any{"a", "b"}},
			theirs: vals{"hosts": []any{"a", "b", "c"}},
			mine:   vals{"hosts": []any{"a", "b"}},
			want:   vals{"hosts": []any{"a", "b", "c"}},
		},
		{
			name: "a list both sides touched is a conflict, not a mixture",
			// Entries carry meaning by position, so merging them pairwise would
			// invent a list neither person wrote.
			base:          vals{"rules": []any{"a"}},
			theirs:        vals{"rules": []any{"a", "b"}},
			mine:          vals{"rules": []any{"a", "c"}},
			want:          vals{"rules": []any{"a", "b"}},
			wantConflicts: []string{"rules"},
		},
		{
			name:          "a subtree replaced by a value is compared as a value",
			base:          vals{"auth": vals{"kind": "basic"}},
			theirs:        vals{"auth": vals{"kind": "oidc"}},
			mine:          vals{"auth": "off"},
			want:          vals{"auth": vals{"kind": "oidc"}},
			wantConflicts: []string{"auth"},
		},
		{
			name:   "nothing changed anywhere",
			base:   vals{"replicas": 1},
			theirs: vals{"replicas": 1},
			mine:   vals{"replicas": 1},
			want:   vals{"replicas": 1},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, conflicts := threeWayMerge(tc.base, tc.theirs, tc.mine)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("merged = %#v, want %#v", got, tc.want)
			}
			var paths []string
			for _, c := range conflicts {
				paths = append(paths, c.Path)
			}
			if !slices.Equal(paths, tc.wantConflicts) {
				t.Errorf("conflicts = %v, want %v", paths, tc.wantConflicts)
			}
		})
	}
}

// A conflict has to carry both sides: the screen that asks the person to choose
// has nothing to show otherwise.
func TestThreeWayMergeConflictCarriesBothSides(t *testing.T) {
	_, conflicts := threeWayMerge(
		vals{"gateway": vals{"port": 80}},
		vals{"gateway": vals{"port": 443}},
		vals{"gateway": vals{"port": 8080}},
	)
	if len(conflicts) != 1 {
		t.Fatalf("want 1 conflict, got %d", len(conflicts))
	}
	c := conflicts[0]
	if c.Path != "gateway.port" || c.Theirs != 443 || c.Mine != 8080 {
		t.Fatalf("conflict = %+v, want gateway.port 443/8080", c)
	}
}

// Merging is only safe if it does not depend on map iteration order.
func TestThreeWayMergeIsDeterministic(t *testing.T) {
	base := vals{"a": 1, "b": 1, "c": 1, "d": 1}
	theirs := vals{"a": 2, "b": 2, "c": 1, "d": 1}
	mine := vals{"a": 3, "b": 3, "c": 2, "d": 1}
	first, firstConflicts := threeWayMerge(base, theirs, mine)
	for range 20 {
		got, conflicts := threeWayMerge(base, theirs, mine)
		if !reflect.DeepEqual(got, first) || !reflect.DeepEqual(conflicts, firstConflicts) {
			t.Fatalf("unstable result: %#v %v vs %#v %v", got, conflicts, first, firstConflicts)
		}
	}
	if conflictPaths(firstConflicts) != "a, b" {
		t.Fatalf("conflict paths = %q, want \"a, b\"", conflictPaths(firstConflicts))
	}
}
