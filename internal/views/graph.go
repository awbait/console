package views

import (
	"fmt"
	"slices"
	"sort"
	"strings"
)

// The "graph" block turns a visual values editor on for one chart version and
// says where that editor's fields live in the values.
//
// Why it lives with the chart version rather than in the portal: the editor does
// not display values, it rewrites them, so it has to know their exact shape. Zip
// that knowledge into a portal release and the next chart version breaks the
// graph for every order still on the old one. Zip it into the version's own view
// document and two versions of one chart carry two mappings that both keep
// working.
//
// The split is deliberate. The DOMAIN lives in the portal as a profile (for
// policies: an arrow out of the order namespace is an egress rule on its source,
// a sender needs a service account, rules of one owner merge into one entry) -
// that is behaviour, and behaviour is code. The block only names the fields that
// behaviour reads and writes, because those are what a chart update moves.

// graphProfile is one domain the portal knows how to draw, with the field names
// it defaults to. A field group lists the fields the profile understands; each
// defaults to a values key of the same name, so a chart that follows the
// convention needs nothing but {"profile": "..."}.
type graphProfile struct {
	entries string
	entry   []string
	rule    []string
	peer    []string
}

// Keep in step with web/src/features/graph/profiles.
var graphProfiles = map[string]graphProfile{
	"policies": {
		entries: "/policies",
		entry:   []string{"name", "enabled", "selector", "serviceAccount", "ingress", "egress"},
		rule:    []string{"ports", "from", "to"},
		peer:    []string{"namespace", "selector", "serviceAccount"},
	},
}

func graphProfileNames() string {
	names := make([]string, 0, len(graphProfiles))
	for n := range graphProfiles {
		names = append(names, n)
	}
	sort.Strings(names)
	return strings.Join(names, ", ")
}

func defaultNames(fields []string) map[string]string {
	out := make(map[string]string, len(fields))
	for _, f := range fields {
		out[f] = f
	}
	return out
}

// validateGraph checks the "graph" block and, when the chart's values.schema.json
// is known, that every field it names exists in that schema. This is the point of
// the whole exercise: a mapping that no longer fits its chart is caught by the
// author in the constructor, not by a user in the middle of an order.
func validateGraph(raw any, schema map[string]any) []Issue {
	m, ok := raw.(map[string]any)
	if !ok {
		return []Issue{{"/graph", `Блок "graph" должен быть объектом: {"profile": "policies"}`}}
	}
	var issues []Issue
	for k := range m {
		switch k {
		case "profile", "enabled", "entries", "entry", "rule", "peer", "$comment":
		default:
			issues = append(issues, Issue{"/graph/" + k, fmt.Sprintf(
				"Лишнее поле %q: допустимы \"profile\", \"enabled\", \"entries\", \"entry\", \"rule\" и \"peer\"", k)})
		}
	}

	profile, _ := m["profile"].(string)
	if profile == "" {
		return append(issues, Issue{"/graph/profile", fmt.Sprintf(
			"Укажите \"profile\" - какой редактор включаем. Доступные: %s", graphProfileNames())})
	}
	p, known := graphProfiles[profile]
	if !known {
		return append(issues, Issue{"/graph/profile", fmt.Sprintf(
			"Редактор %q не существует. Доступные: %s", profile, graphProfileNames())})
	}
	if v, ok := m["enabled"]; ok {
		if _, ok := v.(bool); !ok {
			issues = append(issues, Issue{"/graph/enabled", `Поле "enabled" должно быть true или false`})
		}
	}

	entries := p.entries
	if v, ok := m["entries"]; ok {
		s, ok := v.(string)
		if !ok || !strings.HasPrefix(s, "/") {
			issues = append(issues, Issue{"/graph/entries", fmt.Sprintf(
				"Поле \"entries\" должно быть JSON pointer'ом, строкой вида %q", p.entries)})
		} else {
			entries = s
		}
	}

	names := map[string]map[string]string{
		"entry": defaultNames(p.entry),
		"rule":  defaultNames(p.rule),
		"peer":  defaultNames(p.peer),
	}
	for _, group := range []struct {
		key     string
		allowed []string
	}{{"entry", p.entry}, {"rule", p.rule}, {"peer", p.peer}} {
		raw, ok := m[group.key]
		if !ok {
			continue
		}
		gm, ok := raw.(map[string]any)
		if !ok {
			issues = append(issues, Issue{"/graph/" + group.key, fmt.Sprintf(
				"Блок %q должен быть объектом: он переименовывает поля %s", group.key, strings.Join(group.allowed, ", "))})
			continue
		}
		for k, v := range gm {
			path := "/graph/" + group.key + "/" + k
			if !slices.Contains(group.allowed, k) {
				issues = append(issues, Issue{path, fmt.Sprintf(
					"Поле %q редактор не использует. Здесь можно переименовать: %s", k, strings.Join(group.allowed, ", "))})
				continue
			}
			s, ok := v.(string)
			if !ok || s == "" {
				issues = append(issues, Issue{path, "Укажите имя поля в values (строка)"})
				continue
			}
			if strings.Contains(s, "/") {
				issues = append(issues, Issue{path, fmt.Sprintf(
					"Значение %q должно быть именем одного поля, без \"/\"", s)})
				continue
			}
			names[group.key][k] = s
		}
	}

	if schema == nil {
		return issues
	}
	return append(issues, checkGraphSchema(entries, names, schema)...)
}

// checkGraphSchema walks the mapping against values.schema.json. It follows the
// convention of the rest of this file: only a path that can be PROVEN wrong is
// reported, a schema that stops describing its shape is left alone.
func checkGraphSchema(entries string, names map[string]map[string]string, schema map[string]any) []Issue {
	var issues []Issue
	arr := resolvePointerNode(entries, schema, schema)
	if arr == nil {
		return []Issue{{"/graph/entries", fmt.Sprintf("Путь %q не находит поле в values.schema.json", entries)}}
	}
	if t, _ := arr["type"].(string); t != "" && t != "array" {
		return []Issue{{"/graph/entries", fmt.Sprintf("Путь %q должен указывать на список записей", entries)}}
	}
	elem := itemNode(arr, schema)

	// field returns the schema node of a named property, reporting it when the
	// object describes its properties and this one is not among them.
	field := func(path string, node map[string]any, group, name string) map[string]any {
		if node == nil {
			return nil
		}
		props := collectProperties(node, schema)
		if props == nil {
			return nil // free-form object: nothing to prove
		}
		next, ok := props[names[group][name]].(map[string]any)
		if !ok {
			issues = append(issues, Issue{path, fmt.Sprintf(
				"Поле %q в values.schema.json не найдено", names[group][name])})
			return nil
		}
		return deref(next, schema)
	}

	for _, f := range []string{"name", "enabled", "selector", "serviceAccount"} {
		field("/graph/entry/"+f, elem, "entry", f)
	}
	// Rules and their peers: ingress carries "from", egress carries "to".
	for _, dir := range []struct{ entryField, peerField string }{
		{"ingress", "from"}, {"egress", "to"},
	} {
		rules := field("/graph/entry/"+dir.entryField, elem, "entry", dir.entryField)
		if rules == nil {
			continue
		}
		rule := itemNode(rules, schema)
		field("/graph/rule/ports", rule, "rule", "ports")
		peers := field("/graph/rule/"+dir.peerField, rule, "rule", dir.peerField)
		if peers == nil {
			continue
		}
		peer := itemNode(peers, schema)
		for _, f := range []string{"namespace", "selector", "serviceAccount"} {
			field("/graph/peer/"+f, peer, "peer", f)
		}
	}
	return issues
}
