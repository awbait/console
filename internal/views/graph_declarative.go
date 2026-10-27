package views

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Declarative graphs bind array records to nodes and edge records. Their
// contract is intentionally smaller than the domain-specific policies editor.
func graphObject(v any) map[string]any { m, _ := v.(map[string]any); return m }
func graphString(v any) string         { s, _ := v.(string); return s }
func graphOverlap(a, b string) bool {
	return a == b || strings.HasPrefix(a, b+"/") || strings.HasPrefix(b, a+"/")
}

func graphPointer(p string) bool {
	if !strings.HasPrefix(p, "/") {
		return false
	}
	for _, token := range strings.Split(p[1:], "/") {
		for i := 0; i < len(token); i++ {
			if token[i] == '~' {
				if i+1 >= len(token) || (token[i+1] != '0' && token[i+1] != '1') {
					return false
				}
				i++
			}
		}
		token = strings.ReplaceAll(strings.ReplaceAll(token, "~1", "/"), "~0", "~")
		if token == "" || token == "__proto__" || token == "constructor" || token == "prototype" {
			return false
		}
	}
	return true
}

func graphSchemaNode(pointer string, node, root map[string]any) map[string]any {
	if !graphPointer(pointer) {
		return nil
	}
	current := deref(node, root)
	for _, token := range strings.Split(pointer[1:], "/") {
		token = strings.ReplaceAll(strings.ReplaceAll(token, "~1", "/"), "~0", "~")
		next, ok := collectProperties(current, root)[token].(map[string]any)
		if !ok {
			return nil
		}
		current = deref(next, root)
	}
	return current
}

func graphFormNodes(graph map[string]any, schema map[string]any, out map[string]map[string]any) {
	if graphString(graph["profile"]) != "declarative" {
		return
	}
	for _, group := range []string{"nodes", "relations"} {
		for _, raw := range graphObject(graph[group]) {
			spec := graphObject(raw)
			form := graphString(spec["form"])
			if form == "" || form == "order" {
				continue
			}
			// A form can be reused by several collections. Validate each use
			// below rather than choosing a map iteration's last item schema.
			out[form] = nil
		}
	}
}

func checkDeclarativeGraph(graph, schema, forms map[string]any) []Issue {
	var issues []Issue
	nodes := graphObject(graph["nodes"])
	var paths []string
	for _, group := range []string{"nodes", "relations"} {
		for kind, raw := range graphObject(graph[group]) {
			spec := graphObject(raw)
			base := "/graph/" + group + "/" + kind
			collection := graphString(spec["collection"])
			key := graphString(spec["key"])
			if kind == "constructor" || kind == "prototype" {
				issues = append(issues, Issue{base, "Выберите другое имя типа."})
			}
			for _, path := range paths {
				if graphOverlap(collection, path) {
					issues = append(issues, Issue{base + "/collection", "Коллекции графа не должны пересекаться."})
				}
			}
			paths = append(paths, collection)
			if form := graphString(spec["form"]); form != "" {
				if _, ok := forms[form]; !ok || form == "order" {
					issues = append(issues, Issue{base + "/form", "Укажите существующую форму элемента, отличную от order."})
				}
			}
			pointers := map[string]string{"collection": collection, "key": key}
			if label := graphString(spec["label"]); label != "" {
				pointers["label"] = label
			}
			if group == "relations" {
				for _, side := range []string{"from", "to"} {
					endpoint := graphObject(spec[side])
					if _, ok := nodes[graphString(endpoint["node"])]; !ok {
						issues = append(issues, Issue{base + "/" + side + "/node", "Тип узла не найден."})
					}
					field := graphString(endpoint["field"])
					pointers[side+"/field"] = field
					if graphOverlap(key, field) {
						issues = append(issues, Issue{base + "/" + side + "/field", "Поле ссылки не должно пересекаться с ключом записи."})
					}
				}
				if graphOverlap(pointers["from/field"], pointers["to/field"]) {
					issues = append(issues, Issue{base, "Поля концов связи не должны пересекаться."})
				}
			}
			for name, pointer := range pointers {
				if !graphPointer(pointer) {
					issues = append(issues, Issue{base + "/" + name, "Укажите путь к полю объекта, например /name."})
				}
			}
			if schema == nil || !graphPointer(collection) {
				continue
			}
			arr := graphSchemaNode(collection, schema, schema)
			if arr == nil || graphString(arr["type"]) != "array" {
				issues = append(issues, Issue{base + "/collection", "В схеме по этому пути должен быть массив объектов."})
				continue
			}
			item := itemNode(arr, schema)
			if item == nil || graphString(item["type"]) != "object" {
				issues = append(issues, Issue{base + "/collection", "Элемент коллекции должен быть объектом."})
				continue
			}
			if form := graphString(spec["form"]); form != "" && form != "order" {
				if vm := graphObject(forms[form]); vm != nil {
					issues = append(issues, checkView("/views/"+form, vm, item, schema)...)
				}
			}
			for name, pointer := range pointers {
				if name == "collection" || !graphPointer(pointer) {
					continue
				}
				node := graphSchemaNode(pointer, item, schema)
				if node == nil || graphString(node["type"]) != "string" {
					issues = append(issues, Issue{base + "/" + name, "В схеме по этому пути должно быть строковое поле."})
				}
			}
		}
	}
	return issues
}

// ValidateGraphValues checks identities and references even when values arrive
// from YAML or another API client instead of the graph editor.
func ValidateGraphValues(viewJSON []byte, values map[string]any) []Issue {
	var doc map[string]any
	if json.Unmarshal(viewJSON, &doc) != nil {
		return nil
	}
	graph := graphObject(doc["graph"])
	if graphString(graph["profile"]) != "declarative" || graph["enabled"] == false {
		return nil
	}
	var issues []Issue
	identities := map[string]map[string]bool{}
	lists := map[string][]any{}
	for _, group := range []string{"nodes", "relations"} {
		for kind, raw := range graphObject(graph[group]) {
			spec := graphObject(raw)
			path := graphString(spec["collection"])
			value, found := resolveValuePointer(values, path)
			if !found {
				continue
			}
			list, ok := value.([]any)
			if !ok {
				issues = append(issues, Issue{path, "Ожидается список объектов."})
				continue
			}
			seen := map[string]bool{}
			if group == "nodes" {
				identities[kind] = seen
			} else {
				lists[kind] = list
			}
			for index, value := range list {
				item := graphObject(value)
				key, _ := resolveValuePointer(item, graphString(spec["key"]))
				id, ok := key.(string)
				if !ok || id == "" || seen[id] {
					issues = append(issues, Issue{fmt.Sprintf("%s/%d", path, index), "Укажите уникальный непустой строковый ключ."})
					continue
				}
				seen[id] = true
			}
		}
	}
	for kind, list := range lists {
		spec := graphObject(graphObject(graph["relations"])[kind])
		for index, value := range list {
			for _, side := range []string{"from", "to"} {
				endpoint := graphObject(spec[side])
				ref, _ := resolveValuePointer(graphObject(value), graphString(endpoint["field"]))
				id, ok := ref.(string)
				if !ok || !identities[graphString(endpoint["node"])][id] {
					issues = append(issues, Issue{fmt.Sprintf("%s/%d%s", graphString(spec["collection"]), index, graphString(endpoint["field"])), "Узел, на который ссылается связь, не найден."})
				}
			}
		}
	}
	return issues
}
