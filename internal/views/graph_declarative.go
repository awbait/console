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
	for _, group := range []string{"groups", "nodes", "relations"} {
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
	for _, group := range []string{"groups", "nodes", "relations"} {
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
			if membership := graphObject(spec["group"]); membership != nil {
				pointers["group/field"] = graphString(membership["field"])
				if _, ok := graphObject(graph["groups"])[graphString(membership["type"])]; !ok {
					issues = append(issues, Issue{base + "/group/type", "Тип области не найден."})
				}
				if graphOverlap(key, pointers["group/field"]) || graphObject(spec["display"])["group"] != nil {
					issues = append(issues, Issue{base + "/group", "Ссылка на область не должна пересекаться с ключом или дублировать display.group."})
				}
			}
			if group == "groups" {
				allowed, _ := spec["accepts"].([]any)
				for _, value := range allowed {
					if _, ok := nodes[graphString(value)]; !ok {
						issues = append(issues, Issue{base + "/accepts", "Разрешённый тип узла не найден."})
					}
				}
				if p := graphString(spec["acceptsField"]); p != "" && (!graphPointer(p) || graphOverlap(key, p)) {
					issues = append(issues, Issue{base + "/acceptsField", "Укажите путь к списку типов, не пересекающийся с ключом."})
				}
			}
			displayPointers := map[string]string{}
			display := graphObject(spec["display"])
			for _, name := range []string{"subtitle", "group"} {
				if p := graphString(display[name]); p != "" {
					displayPointers["display/"+name] = p
				}
			}
			rows, _ := display["rows"].([]any)
			seenRows := map[string]bool{}
			for i, rawRow := range rows {
				row := graphObject(rawRow)
				id := graphString(row["id"])
				if seenRows[id] {
					issues = append(issues, Issue{base + "/display/rows", "Идентификаторы строк должны быть уникальными."})
				}
				seenRows[id] = true
				displayPointers[fmt.Sprintf("display/rows/%d/field", i)] = graphString(row["field"])
			}
			for name, pointer := range displayPointers {
				if !graphPointer(pointer) {
					issues = append(issues, Issue{base + "/" + name, "Укажите путь к полю объекта."})
				}
			}
			if label := graphString(spec["label"]); label != "" {
				pointers["label"] = label
			}
			if group == "relations" {
				for _, side := range []string{"from", "to"} {
					endpoint := graphObject(spec[side])
					if rowID := graphString(endpoint["row"]); rowID != "" {
						target := graphObject(nodes[graphString(endpoint["node"])])
						targetRows, _ := graphObject(target["display"])["rows"].([]any)
						found := false
						for _, row := range targetRows {
							if graphString(graphObject(row)["id"]) == rowID {
								found = true
							}
						}
						if !found {
							issues = append(issues, Issue{base + "/" + side + "/row", "Строка карточки не найдена."})
						}
					}
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
			for name, pointer := range displayPointers {
				if graphPointer(pointer) && graphSchemaNode(pointer, item, schema) == nil {
					issues = append(issues, Issue{base + "/" + name, "Поле отображения не найдено в схеме."})
				}
			}
			if p := graphString(spec["acceptsField"]); p != "" {
				node := graphSchemaNode(p, item, schema)
				if graphString(node["type"]) != "array" || graphString(itemNode(node, schema)["type"]) != "string" {
					issues = append(issues, Issue{base + "/acceptsField", "В схеме должен быть массив строковых типов узлов."})
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
	issues = append(issues, graphAreaIssues(graph, values)...)
	return issues
}

func graphTypeAllowed(value any, kind string) bool {
	list, ok := value.([]any)
	if !ok {
		return false
	}
	for _, item := range list {
		if item == kind {
			return true
		}
	}
	return false
}

// Membership is validated on the server as well as by the canvas commands.
func graphAreaIssues(graph, values map[string]any) []Issue {
	var issues []Issue
	areas := map[string]map[string]map[string]any{}
	for kind, raw := range graphObject(graph["groups"]) {
		spec := graphObject(raw)
		path := graphString(spec["collection"])
		value, found := resolveValuePointer(values, path)
		if !found {
			continue
		}
		list, ok := value.([]any)
		if !ok {
			issues = append(issues, Issue{path, "Ожидается список областей."})
			continue
		}
		areas[kind] = map[string]map[string]any{}
		for i, value := range list {
			item := graphObject(value)
			id, _ := resolveValuePointer(item, graphString(spec["key"]))
			key, ok := id.(string)
			if !ok || key == "" || areas[kind][key] != nil {
				issues = append(issues, Issue{fmt.Sprintf("%s/%d", path, i), "Укажите уникальный строковый ключ области."})
				continue
			}
			areas[kind][key] = item
			if field := graphString(spec["acceptsField"]); field != "" {
				allowed, found := resolveValuePointer(item, field)
				if !found {
					continue
				}
				items, ok := allowed.([]any)
				valid := ok
				for _, nodeKind := range items {
					if s, ok := nodeKind.(string); !ok || !graphTypeAllowed(spec["accepts"], s) {
						valid = false
					}
				}
				if !valid {
					issues = append(issues, Issue{fmt.Sprintf("%s/%d%s", path, i, field), "Список разрешённых типов некорректен."})
				}
			}
		}
	}
	for kind, raw := range graphObject(graph["nodes"]) {
		spec := graphObject(raw)
		membership := graphObject(spec["group"])
		if membership == nil {
			continue
		}
		areaType := graphString(membership["type"])
		areaSpec := graphObject(graphObject(graph["groups"])[areaType])
		value, _ := resolveValuePointer(values, graphString(spec["collection"]))
		list, _ := value.([]any)
		for i, value := range list {
			ref, _ := resolveValuePointer(graphObject(value), graphString(membership["field"]))
			key, ok := ref.(string)
			area := areas[areaType][key]
			path := fmt.Sprintf("%s/%d%s", graphString(spec["collection"]), i, graphString(membership["field"]))
			if !ok || area == nil {
				issues = append(issues, Issue{path, "Область узла не найдена."})
				continue
			}
			allowed := graphTypeAllowed(areaSpec["accepts"], kind)
			if field := graphString(areaSpec["acceptsField"]); field != "" {
				list, found := resolveValuePointer(area, field)
				if found {
					allowed = allowed && graphTypeAllowed(list, kind)
				}
			}
			if !allowed {
				issues = append(issues, Issue{path, "Этот тип узла нельзя размещать в выбранной области."})
			}
		}
	}
	return issues
}
