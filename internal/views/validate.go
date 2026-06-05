// Package views валидирует view-документы публикаций чартов: структуру формата
// (views.* с include/exclude/overrides/identity) и — при наличии values.schema.json
// чарта — ссылки на реальные поля схемы. Схема чарта остаётся единственным
// источником истины; view только проецирует её поля.
package views

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Issue — одна проблема валидации; Path указывает внутрь view-документа
// (JSON pointer), для ошибок ссылок на схему — на ссылающееся поле.
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
// (неизвестная структура схемы пропускается молча — проверяем лишь то, что
// можем доказать).
func Validate(viewJSON, schemaJSON []byte) []Issue {
	var issues []Issue
	var doc map[string]any
	if err := json.Unmarshal(viewJSON, &doc); err != nil {
		return []Issue{{Path: "", Message: "невалидный JSON: " + err.Error()}}
	}
	for k := range doc {
		switch k {
		case "views", "version", "$comment":
		default:
			issues = append(issues, Issue{"/" + k, "неизвестное поле на верхнем уровне (ожидаются views, version)"})
		}
	}
	viewsRaw, ok := doc["views"]
	if !ok {
		return append(issues, Issue{"", `отсутствует обязательное поле "views"`})
	}
	viewsMap, ok := viewsRaw.(map[string]any)
	if !ok {
		return append(issues, Issue{"/views", "должно быть объектом"})
	}
	if len(viewsMap) == 0 {
		issues = append(issues, Issue{"/views", "не задано ни одной view"})
	}

	var schema map[string]any
	if len(schemaJSON) > 0 {
		// Сломанную схему чарта не вменяем view-документу — просто без кросс-проверок.
		_ = json.Unmarshal(schemaJSON, &schema)
	}

	for name, v := range viewsMap {
		path := "/views/" + name
		vm, ok := v.(map[string]any)
		if !ok {
			issues = append(issues, Issue{path, "view должна быть объектом"})
			continue
		}
		issues = append(issues, validateView(path, vm, schema, schema, true)...)
	}
	return issues
}

// validateView проверяет одну view (или вложенный ui:view) против узла схемы.
// node — узел схемы, на чьи поля ссылается view (nil = проверка невозможна).
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
			issues = append(issues, Issue{path + "/" + key, "должно быть массивом строк"})
			return
		}
		for i, item := range list {
			s, ok := item.(string)
			if !ok {
				issues = append(issues, Issue{fmt.Sprintf("%s/%s/%d", path, key, i), "должно быть строкой"})
				continue
			}
			if props != nil && props[s] == nil {
				issues = append(issues, Issue{fmt.Sprintf("%s/%s/%d", path, key, i),
					fmt.Sprintf("поле %q отсутствует в схеме чарта", s)})
			}
		}
	}

	for k, v := range vm {
		switch k {
		case "$comment":
		case "identity":
			s, ok := v.(string)
			if !ok || !strings.HasPrefix(s, "/") {
				issues = append(issues, Issue{path + "/identity", `должно быть JSON pointer'ом (строка, начинается с "/")`})
				continue
			}
			if !top {
				issues = append(issues, Issue{path + "/identity", "identity допустим только на верхнем уровне view"})
				continue
			}
			if node != nil && !pointerResolves(s, node, root) {
				issues = append(issues, Issue{path + "/identity",
					fmt.Sprintf("указатель %q не находит поле в схеме чарта", s)})
			}
		case "include", "exclude", "required":
			checkFieldList(k)
		case "overrides":
			om, ok := v.(map[string]any)
			if !ok {
				issues = append(issues, Issue{path + "/overrides", "должно быть объектом"})
				continue
			}
			for field, ov := range om {
				fp := path + "/overrides/" + field
				var fieldNode map[string]any
				if props != nil {
					if props[field] == nil {
						issues = append(issues, Issue{fp, fmt.Sprintf("поле %q отсутствует в схеме чарта", field)})
					} else {
						fieldNode, _ = props[field].(map[string]any)
					}
				}
				ovm, ok := ov.(map[string]any)
				if !ok {
					issues = append(issues, Issue{fp, "override должен быть объектом"})
					continue
				}
				issues = append(issues, validateOverride(fp, ovm, fieldNode, root)...)
			}
		default:
			issues = append(issues, Issue{path + "/" + k,
				"неизвестное поле view (ожидаются identity, include, exclude, required, overrides)"})
		}
	}
	return issues
}

// validateOverride проверяет известные ключи override; прочие ключи — это
// schema-хинты (title/description/enum/...), их пропускаем.
func validateOverride(path string, ovm, fieldNode, root map[string]any) []Issue {
	var issues []Issue
	for k, v := range ovm {
		switch k {
		case "ui:widget":
			s, ok := v.(string)
			if !ok || !knownWidgets[s] {
				issues = append(issues, Issue{path + "/ui:widget", `допустимые значения: "single", "edit", "hidden"`})
			}
		case "ui:view":
			vm, ok := v.(map[string]any)
			if !ok {
				issues = append(issues, Issue{path + "/ui:view", "должно быть объектом"})
				continue
			}
			// Вложенный ui:view применяется к полям объекта; для массива —
			// к элементу (массив рендерится списком карточек или как single).
			child := itemNode(fieldNode, root)
			issues = append(issues, validateView(path+"/ui:view", vm, child, root, false)...)
		case "title":
			if _, ok := v.(string); !ok {
				issues = append(issues, Issue{path + "/title", "должно быть строкой"})
			}
		}
	}
	return issues
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
// allOf/oneOf/anyOf/then/else (поля могут жить в условных ветках). nil — узел
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
// массива — items (view описывает один элемент), иначе сам узел.
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
// прочие — в properties. Неизвестные участки схемы считаются совпадением
// (доказать ошибку нельзя).
func pointerResolves(ptr string, node, root map[string]any) bool {
	cur := deref(node, root)
	for seg := range strings.SplitSeq(strings.TrimPrefix(ptr, "/"), "/") {
		if cur == nil {
			return true // дальше схема не описана — не вменяем
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
