package views

import "testing"

const uniqueView = `{
  "views": {
    "order": {
      "include": ["xroutes"],
      "overrides": { "xroutes": { "ui:uniqueBy": "name" } }
    }
  }
}`

func TestUniqueRules(t *testing.T) {
	rules := UniqueRules([]byte(uniqueView))
	if len(rules) != 1 || rules[0].Field != "xroutes" || rules[0].By != "name" {
		t.Fatalf("rules = %+v", rules)
	}
	if got := UniqueRules([]byte(`{"views":{"order":{"include":["xroutes"]}}}`)); len(got) != 0 {
		t.Errorf("a view that says nothing produced %+v", got)
	}
	if got := UniqueRules([]byte("not json")); len(got) != 0 {
		t.Errorf("unreadable document produced %+v", got)
	}
}

func route(name string, path string) map[string]any {
	return map[string]any{"name": name, "path": path}
}

// The case this exists for: two entries with one name and different contents.
// uniqueItems would accept them, and be right to - they are different entries.
func TestFindDuplicate(t *testing.T) {
	rules := UniqueRules([]byte(uniqueView))
	values := map[string]any{"xroutes": []any{
		route("app", "/"), route("api", "/api"), route("app", "/other"),
	}}

	d, found := FindDuplicate(values, rules)
	if !found {
		t.Fatal("two entries named app went through")
	}
	if d.Value != "app" || d.Index != 2 || d.Field != "xroutes" || d.By != "name" {
		t.Errorf("duplicate = %+v", d)
	}
	if got := DuplicateMessage(d); got != "Имя «app» уже занято. Дайте этой записи другое имя." {
		t.Errorf("message = %q", got)
	}
}

func TestFindDuplicateAcceptsWhatItShould(t *testing.T) {
	rules := UniqueRules([]byte(uniqueView))
	for name, values := range map[string]map[string]any{
		"different names": {"xroutes": []any{route("app", "/"), route("api", "/api")}},
		"one entry":       {"xroutes": []any{route("app", "/")}},
		"empty list":      {"xroutes": []any{}},
		"no list at all":  {},
		// A name nobody filled in yet is the form being filled in, not a
		// collision: the required check is what speaks about an empty field.
		"unnamed entries": {"xroutes": []any{route("", "/"), route("", "/api")}},
		// Values that are not what the rule expects are none of its business.
		"not a list":              {"xroutes": "app"},
		"entries are not objects": {"xroutes": []any{"app", "app"}},
	} {
		if d, found := FindDuplicate(values, rules); found {
			t.Errorf("%s: refused as a duplicate (%+v)", name, d)
		}
	}
}

// A list inside a chart dependency is named the way a view names any other field
// of one, so the rule has to walk the same path.
func TestFindDuplicateInsideADependency(t *testing.T) {
	rules := UniqueRules([]byte(`{"views":{"order":{"overrides":{"pooler/items":{"ui:uniqueBy":"name"}}}}}`))
	values := map[string]any{"pooler": map[string]any{"items": []any{route("a", ""), route("a", "")}}}

	if _, found := FindDuplicate(values, rules); !found {
		t.Error("a duplicate inside a dependency went through")
	}
}
