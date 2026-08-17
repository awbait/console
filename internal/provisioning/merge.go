package provisioning

import (
	"reflect"
	"sort"
	"strings"
)

// Three-way merge of an order's values.
//
// An order's change is written against the state of the target branch at the
// moment the form was opened. By the time it is merged that branch may hold
// someone else's change to the same file, and Git refuses the merge on the
// text: two edits a line apart are a conflict to it even when they touch
// unrelated settings.
//
// Values are not text, though - they are a tree of named fields, and that is
// what the portal merges. Fields the person did not touch keep whatever the
// branch says now; fields only they touched keep their edit. Only a field both
// sides moved to different values is a real disagreement, and only that is
// worth asking a person about.
//
// Lists are compared whole, not element by element. A list in a chart's values
// is an ordered thing whose entries carry meaning by position (gateway rules,
// policy directions), so merging entries pairwise would invent combinations
// neither side wrote. Two sides editing the same list is a conflict.

// mergeConflict is one field both sides changed, to different values.
type mergeConflict struct {
	// Path is the dotted field path, e.g. "gateway.hosts" - written for a person
	// to recognise on the order form, not as a JSON pointer.
	Path string
	// Theirs and Mine are the two values in disagreement, for showing the choice.
	Theirs any
	Mine   any
}

// threeWayMerge merges mine and theirs over their common base, field by field.
// It returns the merged tree and every field the two sides disagree on; when
// there is any conflict the merged tree is incomplete by definition and must
// not be committed - conflicting fields carry theirs, so the caller can still
// show a diff without deciding anything.
func threeWayMerge(base, theirs, mine map[string]any) (map[string]any, []mergeConflict) {
	merged, conflicts := mergeMaps("", base, theirs, mine)
	sort.Slice(conflicts, func(i, j int) bool { return conflicts[i].Path < conflicts[j].Path })
	return merged, conflicts
}

func mergeMaps(prefix string, base, theirs, mine map[string]any) (map[string]any, []mergeConflict) {
	out := map[string]any{}
	var conflicts []mergeConflict
	for _, key := range unionKeys(base, theirs, mine) {
		path := key
		if prefix != "" {
			path = prefix + "." + key
		}
		b, bok := base[key]
		t, tok := theirs[key]
		m, mok := mine[key]

		// Both sides still have a subtree here: merge inside it rather than
		// treating the whole branch of the tree as one value. A side that
		// replaced the subtree with a scalar falls through to the value rules.
		tm, tIsMap := t.(map[string]any)
		mm, mIsMap := m.(map[string]any)
		if tIsMap && mIsMap {
			bm, _ := b.(map[string]any) // a non-map (or absent) base: both sides added it
			sub, subConflicts := mergeMaps(path, bm, tm, mm)
			out[key] = sub
			conflicts = append(conflicts, subConflicts...)
			continue
		}

		mineChanged := !sameValue(b, bok, m, mok)
		theirsChanged := !sameValue(b, bok, t, tok)
		switch {
		case !mineChanged:
			// Untouched by this order: whatever the branch holds now wins, which
			// is how someone else's edit survives being merged over.
			if tok {
				out[key] = t
			}
		case !theirsChanged:
			if mok {
				out[key] = m
			}
		case sameValue(t, tok, m, mok):
			// Both arrived at the same thing - agreement, not conflict.
			if mok {
				out[key] = m
			}
		default:
			conflicts = append(conflicts, mergeConflict{Path: path, Theirs: t, Mine: m})
			if tok {
				out[key] = t
			}
		}
	}
	return out, conflicts
}

// sameValue compares two optional values. Absence is a value of its own: a
// field deleted on one side and edited on the other is a disagreement, and
// treating a missing field as an empty one would silently resurrect it.
func sameValue(a any, aok bool, b any, bok bool) bool {
	if aok != bok {
		return false
	}
	if !aok {
		return true
	}
	return reflect.DeepEqual(a, b)
}

// unionKeys returns every key of the three maps, in a stable order so conflicts
// and the merged output do not depend on map iteration.
func unionKeys(maps ...map[string]any) []string {
	seen := map[string]bool{}
	var out []string
	for _, m := range maps {
		for k := range m {
			if !seen[k] {
				seen[k] = true
				out = append(out, k)
			}
		}
	}
	sort.Strings(out)
	return out
}

// conflictPaths lists the field paths of a set of conflicts, for a log line or
// a timeline entry.
func conflictPaths(conflicts []mergeConflict) string {
	paths := make([]string, 0, len(conflicts))
	for _, c := range conflicts {
		paths = append(paths, c.Path)
	}
	return strings.Join(paths, ", ")
}
