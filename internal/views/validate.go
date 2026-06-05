// Package views валидирует view-документы публикаций чартов: структуру формата
// (views.* с include/exclude/overrides/identity) и, при наличии values.schema.json
// чарта, ссылки на реальные поля схемы. Схема чарта остаётся единственным
// источником истины; view только проецирует её поля.
package views

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
)

// Issue, одна проблема валидации; Path указывает внутрь view-документа
// (JSON pointer), для ошибок ссылок на схему, на ссылающееся поле.
type Issue struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

// Известные виджеты ui:widget (см. web/src/form/SchemaForm.tsx).
var knownWidgets = map[string]bool{"single": true, "edit": true, "hidden": true}

// ValidateStructure проверяет только формат документа (без схемы чарта).
func ValidateStructure(viewJSON []byte) []Issue {
	return Validate(viewJSON, nil)
}

// Validate проверяет view-документ. Когда schemaJSON непуст, дополнительно
// сверяет include/exclude/overrides/identity с полями values.schema.json
// (неизвестная структура схемы пропускается молча, проверяем лишь то, что
// можем доказать).
func Validate(viewJSON, schemaJSON []byte) []Issue {
	var issues []Issue
	var doc map[string]any
	if err := json.Unmarshal(viewJSON, &doc); err != nil {
		return []Issue{{Path: "", Message: "Невалидный JSON: " + err.Error()}}
	}
	// json.Unmarshal молча схлопывает дублирующиеся ключи (вторая "order"
	// перетёрла бы первую), ловим их токен-сканом до содержательных проверок.
	issues = append(issues, duplicateKeys(viewJSON)...)
	for k := range doc {
		switch k {
		case "views", "version", "$comment":
		default:
			issues = append(issues, Issue{"/" + k,
				fmt.Sprintf("Лишнее поле %q: на верхнем уровне допустимы только \"views\" и \"version\"", k)})
		}
	}
	viewsRaw, ok := doc["views"]
	if !ok {
		return append(issues, Issue{"", `В документе нет блока "views". Добавьте {"views": {"order": { ... }}}`})
	}
	viewsMap, ok := viewsRaw.(map[string]any)
	if !ok {
		return append(issues, Issue{"/views", `Блок "views" должен быть объектом: {"views": {"order": { ... }}}`})
	}
	if len(viewsMap) == 0 {
		issues = append(issues, Issue{"/views", `Блок "views" пуст. Опишите хотя бы view "order" (форму заказа)`})
	}
	// view "order" обязательна и ровно одна: по ней строится форма заказа и
	// пункт в меню (дубль ключа поймал бы duplicateKeys выше).
	if _, ok := viewsMap["order"]; !ok && len(viewsMap) > 0 {
		issues = append(issues, Issue{"",
			`Не хватает view "order": это форма заказа, она обязательна и должна быть ровно одна`})
	}

	var schema map[string]any
	if len(schemaJSON) > 0 {
		// Сломанную схему чарта не вменяем view-документу, просто без кросс-проверок.
		_ = json.Unmarshal(schemaJSON, &schema)
	}

	for name, v := range viewsMap {
		path := "/views/" + name
		vm, ok := v.(map[string]any)
		if !ok {
			issues = append(issues, Issue{path,
				fmt.Sprintf("View %q должна быть объектом с полями include/exclude/overrides", name)})
			continue
		}
		issues = append(issues, validateView(path, vm, schema, schema, true)...)
	}
	return issues
}

// validateView проверяет одну view (или вложенный ui:view) против узла схемы.
// node, узел схемы, на чьи поля ссылается view (nil = проверка невозможна).
func validateView(path string, vm map[string]any, node, root map[string]any, top bool) []Issue {
	var issues []Issue
	props := collectProperties(node, root)

	checkFieldList := func(key string) {
		raw, ok := vm[key]
		if !ok {
			return
		}
		list, ok := raw.([]any)
		if !ok {
			issues = append(issues, Issue{path + "/" + key,
				fmt.Sprintf("Поле %q должно быть массивом имён полей схемы, например [\"naming\", \"gateways\"]", key)})
			return
		}
		for i, item := range list {
			s, ok := item.(string)
			if !ok {
				issues = append(issues, Issue{fmt.Sprintf("%s/%s/%d", path, key, i),
					fmt.Sprintf("Элементы %q должны быть строками, именами полей из values.schema.json", key)})
				continue
			}
			if props != nil && props[s] == nil {
				issues = append(issues, Issue{fmt.Sprintf("%s/%s/%d", path, key, i),
					fmt.Sprintf("Definition %q не найден в values.schema.json. Сверьтесь со вкладкой схемы", s)})
			}
		}
	}

	for k, v := range vm {
		switch k {
		case "$comment":
		case "identity":
			s, ok := v.(string)
			if !ok || !strings.HasPrefix(s, "/") {
				issues = append(issues, Issue{path + "/identity",
					`Поле "identity" должно быть JSON pointer'ом, строкой вида "/gateways/0/name"`})
				continue
			}
			if !top {
				issues = append(issues, Issue{path + "/identity",
					`Поле "identity" допустимо только на верхнем уровне view. Уберите его из ui:view`})
				continue
			}
			if node != nil && !pointerResolves(s, node, root) {
				issues = append(issues, Issue{path + "/identity",
					fmt.Sprintf("Указатель %q не находит поле в values.schema.json. Проверьте путь", s)})
			}
		case "include", "exclude", "required":
			checkFieldList(k)
		case "overrides":
			om, ok := v.(map[string]any)
			if !ok {
				issues = append(issues, Issue{path + "/overrides",
					`Поле "overrides" должно быть объектом: {"<имя поля>": { настройки }}`})
				continue
			}
			for field, ov := range om {
				fp := path + "/overrides/" + field
				var fieldNode map[string]any
				if props != nil {
					if props[field] == nil {
						issues = append(issues, Issue{fp,
							fmt.Sprintf("Definition %q не найден в values.schema.json. Сверьтесь со вкладкой схемы", field)})
					} else {
						fieldNode, _ = props[field].(map[string]any)
					}
				}
				ovm, ok := ov.(map[string]any)
				if !ok {
					issues = append(issues, Issue{fp,
						"Настройка поля должна быть объектом (title, ui:widget, ui:view, …)"})
					continue
				}
				issues = append(issues, validateOverride(fp, ovm, fieldNode, root)...)
			}
		default:
			issues = append(issues, Issue{path + "/" + k,
				fmt.Sprintf("Неизвестное поле %q: во view допустимы identity, include, exclude, required, overrides", k)})
		}
	}
	return issues
}

// validateOverride проверяет известные ключи override; прочие ключи, это
// schema-хинты (title/description/enum/...), их пропускаем.
func validateOverride(path string, ovm, fieldNode, root map[string]any) []Issue {
	var issues []Issue
	for k, v := range ovm {
		switch k {
		case "ui:widget":
			s, ok := v.(string)
			if !ok || !knownWidgets[s] {
				issues = append(issues, Issue{path + "/ui:widget",
					fmt.Sprintf("Неизвестный виджет %v: доступны \"single\", \"edit\", \"hidden\"", v)})
			}
		case "ui:view":
			vm, ok := v.(map[string]any)
			if !ok {
				issues = append(issues, Issue{path + "/ui:view",
					`Поле "ui:view" должно быть объектом вложенной view (include/exclude/overrides)`})
				continue
			}
			// Вложенный ui:view применяется к полям объекта; для массива
			// к элементу (массив рендерится списком карточек или как single).
			child := itemNode(fieldNode, root)
			issues = append(issues, validateView(path+"/ui:view", vm, child, root, false)...)
		case "title":
			if _, ok := v.(string); !ok {
				issues = append(issues, Issue{path + "/title", `Поле "title" должно быть строкой`})
			}
		}
	}
	return issues
}

// duplicateKeys токен-сканом находит повторяющиеся ключи в объектах документа
// (json.Unmarshal их молча схлопывает, теряя данные).
func duplicateKeys(data []byte) []Issue {
	dec := json.NewDecoder(bytes.NewReader(data))
	var scanValue func(path string) []Issue
	scanValue = func(path string) []Issue {
		t, err := dec.Token()
		if err != nil {
			return nil
		}
		d, ok := t.(json.Delim)
		if !ok {
			return nil // скаляр
		}
		var issues []Issue
		switch d {
		case '{':
			seen := map[string]bool{}
			for dec.More() {
				kt, err := dec.Token()
				if err != nil {
					return issues
				}
				key, _ := kt.(string)
				kp := path + "/" + key
				if seen[key] {
					issues = append(issues, Issue{kp,
						fmt.Sprintf("Ключ %q указан дважды, JSON оставит только последнее значение. Уберите дубль", key)})
				}
				seen[key] = true
				issues = append(issues, scanValue(kp)...)
			}
			_, _ = dec.Token() // '}'
		case '[':
			for i := 0; dec.More(); i++ {
				issues = append(issues, scanValue(fmt.Sprintf("%s/%d", path, i))...)
			}
			_, _ = dec.Token() // ']'
		}
		return issues
	}
	return scanValue("")
}

// --- навигация по схеме ---

// deref разворачивает $ref внутри документа схемы (#/definitions/...).
func deref(node, root map[string]any) map[string]any {
	for range 10 { // защита от циклов
		ref, _ := node["$ref"].(string)
		if ref == "" || !strings.HasPrefix(ref, "#/") || root == nil {
			return node
		}
		cur := any(root)
		for seg := range strings.SplitSeq(strings.TrimPrefix(ref, "#/"), "/") {
			m, ok := cur.(map[string]any)
			if !ok {
				return node
			}
			cur = m[seg]
		}
		next, ok := cur.(map[string]any)
		if !ok {
			return node
		}
		node = next
	}
	return node
}

// collectProperties собирает объединённые properties узла: собственные + ветки
// allOf/oneOf/anyOf/then/else (поля могут жить в условных ветках). nil, узел
// неизвестен или не описывает объект с properties (проверки пропускаются).
func collectProperties(node, root map[string]any) map[string]any {
	if node == nil {
		return nil
	}
	node = deref(node, root)
	out := map[string]any{}
	var walk func(n map[string]any)
	walk = func(n map[string]any) {
		n = deref(n, root)
		if props, ok := n["properties"].(map[string]any); ok {
			for k, v := range props {
				if _, dup := out[k]; !dup {
					out[k] = v
				}
			}
		}
		for _, branchKey := range []string{"allOf", "oneOf", "anyOf"} {
			if list, ok := n[branchKey].([]any); ok {
				for _, b := range list {
					if bm, ok := b.(map[string]any); ok {
						walk(bm)
					}
				}
			}
		}
		for _, branchKey := range []string{"then", "else"} {
			if bm, ok := n[branchKey].(map[string]any); ok {
				walk(bm)
			}
		}
	}
	walk(node)
	if len(out) == 0 {
		return nil
	}
	return out
}

// itemNode возвращает узел, к чьим полям применяется вложенный ui:view: для
// массива, items (view описывает один элемент), иначе сам узел.
func itemNode(node, root map[string]any) map[string]any {
	if node == nil {
		return nil
	}
	node = deref(node, root)
	if t, _ := node["type"].(string); t == "array" {
		items, _ := node["items"].(map[string]any)
		if items == nil {
			return nil
		}
		return deref(items, root)
	}
	return node
}

// pointerResolves проверяет, что JSON pointer по values (например
// /gateways/0/name) находит поле в схеме: числовой сегмент шагает в items,
// прочие, в properties. Неизвестные участки схемы считаются совпадением
// (доказать ошибку нельзя).
func pointerResolves(ptr string, node, root map[string]any) bool {
	cur := deref(node, root)
	for seg := range strings.SplitSeq(strings.TrimPrefix(ptr, "/"), "/") {
		if cur == nil {
			return true // дальше схема не описана, не вменяем
		}
		if isIndex(seg) {
			if t, _ := cur["type"].(string); t != "" && t != "array" {
				return false
			}
			items, _ := cur["items"].(map[string]any)
			if items == nil {
				return true
			}
			cur = deref(items, root)
			continue
		}
		props := collectProperties(cur, root)
		if props == nil {
			return true // free-form объект
		}
		next, ok := props[seg].(map[string]any)
		if !ok {
			return false
		}
		cur = deref(next, root)
	}
	return true
}

func isIndex(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}
