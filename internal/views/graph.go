package views

import (
	"encoding/json"
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

// GraphMapping is where a chart version keeps the fields a graph profile reads,
// resolved: the profile's defaults with the version's renames applied.
type GraphMapping struct {
	Profile string
	Entries string            // JSON pointer to the list of entries in the values
	Entry   map[string]string // profile field -> values key
	Rule    map[string]string
	Peer    map[string]string
}

// ReadGraphMapping returns the mapping a version's view document declares, or
// nil when the version has no graph: no block, the block switched off, or a
// profile this portal does not implement. Mirrors readGraphMapping in
// web/src/features/graph/mapping.ts - both sides have to agree on whether a
// version has a graph at all.
func ReadGraphMapping(viewJSON []byte) *GraphMapping {
	var doc struct {
		Graph map[string]any `json:"graph"`
	}
	if err := json.Unmarshal(viewJSON, &doc); err != nil || doc.Graph == nil {
		return nil
	}
	if enabled, ok := doc.Graph["enabled"].(bool); ok && !enabled {
		return nil
	}
	profile, _ := doc.Graph["profile"].(string)
	p, known := graphProfiles[profile]
	if !known {
		return nil
	}
	m := &GraphMapping{
		Profile: profile,
		Entries: p.entries,
		Entry:   defaultNames(p.entry),
		Rule:    defaultNames(p.rule),
		Peer:    defaultNames(p.peer),
	}
	if s, ok := doc.Graph["entries"].(string); ok && strings.HasPrefix(s, "/") {
		m.Entries = s
	}
	for key, names := range map[string]map[string]string{
		"entry": m.Entry, "rule": m.Rule, "peer": m.Peer,
	} {
		group, _ := doc.Graph[key].(map[string]any)
		for k, v := range group {
			// Only fields the profile has, renamed to a plain key. Anything else is
			// the author's typo, already reported as an issue on the version.
			s, ok := v.(string)
			if _, known := names[k]; known && ok && s != "" && !strings.Contains(s, "/") {
				names[k] = s
			}
		}
	}
	return m
}

// CountGraphRules counts the rules the graph editor would show as arrows in
// these values: every incoming and outgoing rule of every entry. Zero means the
// order draws nothing, and a chart driven by this section renders nothing from
// it - which is what makes it worth refusing before it reaches a cluster.
func (m *GraphMapping) CountGraphRules(values map[string]any) int {
	node, ok := resolveValuePointer(values, m.Entries)
	if !ok {
		return 0
	}
	list, ok := node.([]any)
	if !ok {
		return 0
	}
	n := 0
	for _, e := range list {
		entry, ok := e.(map[string]any)
		if !ok {
			continue
		}
		for _, dir := range []string{"ingress", "egress"} {
			if rules, ok := entry[m.Entry[dir]].([]any); ok {
				n += len(rules)
			}
		}
	}
	return n
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

// checkGraph checks what the "graph" block's own profile decides: which profile
// exists, which fields that profile understands, and - when the chart's
// values.schema.json is known - that every field the block names exists in that
// schema. This is the point of the whole exercise: a mapping that no longer fits
// its chart is caught by the author in the constructor, not by a user in the
// middle of an order. The block's plain shape is described in
// document.schema.json and checked before this runs.
func checkGraph(m map[string]any, schema map[string]any) []Issue {
	profile, _ := m["profile"].(string)
	if profile == "" {
		return nil // the document schema already asked for a profile
	}
	p, known := graphProfiles[profile]
	if !known {
		return []Issue{{"/graph/profile", fmt.Sprintf(
			"Редактор %q не существует. Доступные: %s", profile, graphProfileNames())}}
	}

	var issues []Issue
	entries := p.entries
	if s, ok := m["entries"].(string); ok && strings.HasPrefix(s, "/") {
		entries = s
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
		gm, _ := m[group.key].(map[string]any)
		for k, v := range gm {
			path := "/graph/" + group.key + "/" + k
			if !slices.Contains(group.allowed, k) {
				issues = append(issues, Issue{path, fmt.Sprintf(
					"Поле %q редактор не использует. Здесь можно переименовать: %s", k, strings.Join(group.allowed, ", "))})
				continue
			}
			// A name the document schema has already refused (not a string, empty,
			// or with a "/" in it) is left as the profile's default: the block is
			// reported once, and the schema walk below stays on solid ground.
			if s, ok := v.(string); ok && s != "" && !strings.Contains(s, "/") {
				names[group.key][k] = s
			}
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
	//
	// A peer's serviceAccount is the SENDER's, and it is only ever written on the
	// incoming side (it feeds the AuthorizationPolicy principal). An egress rule
	// addresses its destination by namespace and selector, so a chart that has no
	// serviceAccount on the outgoing peer is right and must not be reported.
	for _, dir := range []struct {
		entryField, peerField string
		peerFields            []string
	}{
		{"ingress", "from", []string{"namespace", "selector", "serviceAccount"}},
		{"egress", "to", []string{"namespace", "selector"}},
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
		for _, f := range dir.peerFields {
			field("/graph/peer/"+f, peer, "peer", f)
		}
	}
	return issues
}
