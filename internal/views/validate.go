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
		case "views", "tabs", "actions", "version", "$comment":
		default:
			issues = append(issues, Issue{"/" + k,
				fmt.Sprintf("Лишнее поле %q: на верхнем уровне допустимы только \"views\", \"tabs\", \"actions\" и \"version\"", k)})
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

	// Формы, используемые вкладкой как form, проецируют ЭЛЕМЕНТ массива items, а
	// не корень схемы, поэтому их include/exclude сверяются с полями элемента.
	formNode := map[string]map[string]any{}
	if tabsArr, ok := doc["tabs"].([]any); ok && schema != nil {
		for _, it := range tabsArr {
			m, _ := it.(map[string]any)
			form, _ := m["form"].(string)
			items, _ := m["items"].(string)
			if form == "" || items == "" {
				continue
			}
			if arr := resolvePointerNode(items, schema, schema); arr != nil {
				formNode[form] = itemNode(arr, schema)
			}
		}
	}

	for name, v := range viewsMap {
		path := "/views/" + name
		vm, ok := v.(map[string]any)
		if !ok {
			issues = append(issues, Issue{path,
				fmt.Sprintf("View %q должна быть объектом с полями include/exclude/overrides", name)})
			continue
		}
		node := schema
		if n, ok := formNode[name]; ok {
			node = n // форма элемента вкладки: сверяем с полями элемента массива
		}
		issues = append(issues, validateView(path, vm, node, schema, true)...)
	}

	// tabs: вкладки продукта (таблицы-списки). Возвращает множество id вкладок,
	// на которые могут ссылаться actions через "tab:<id>".
	tabIDs := map[string]bool{}
	if tabsRaw, ok := doc["tabs"]; ok {
		var tabIssues []Issue
		tabIssues, tabIDs = validateTabs(tabsRaw, viewsMap, schema)
		issues = append(issues, tabIssues...)
	}

	// actions: размещение формы-view в меню «Действия» (info или вкладка tab:<id>).
	if actionsRaw, ok := doc["actions"]; ok {
		issues = append(issues, validateActions(actionsRaw, viewsMap, tabIDs)...)
	}
	return issues
}

// validateTabs проверяет вкладки продукта. Каждая вкладка это таблица-список:
// items (JSON pointer на массив в values), form (id формы из views для
// добавления/редактирования элемента) и опциональный ui:table (колонки).
// Возвращает issues и множество id вкладок (для ссылок из actions).
func validateTabs(raw any, viewsMap, schema map[string]any) ([]Issue, map[string]bool) {
	ids := map[string]bool{}
	arr, ok := raw.([]any)
	if !ok {
		return []Issue{{"/tabs", `Блок "tabs" должен быть массивом: [{"id": "...", "items": "...", "form": "..."}]`}}, ids
	}
	reserved := map[string]bool{"info": true, "history": true, "order": true}
	var issues []Issue
	for i, it := range arr {
		p := fmt.Sprintf("/tabs/%d", i)
		m, ok := it.(map[string]any)
		if !ok {
			issues = append(issues, Issue{p, `Вкладка должна быть объектом {"id": "...", "items": "...", "form": "..."}`})
			continue
		}
		id, _ := m["id"].(string)
		switch {
		case id == "":
			issues = append(issues, Issue{p + "/id", `Укажите "id" вкладки (строка)`})
		case reserved[id]:
			issues = append(issues, Issue{p + "/id", fmt.Sprintf("Id %q зарезервирован (info/history/order)", id)})
		case ids[id]:
			issues = append(issues, Issue{p + "/id", fmt.Sprintf("Вкладка с id %q уже есть", id)})
		default:
			ids[id] = true
		}
		if t, ok := m["title"]; ok {
			if _, ok := t.(string); !ok {
				issues = append(issues, Issue{p + "/title", `Поле "title" должно быть строкой (заголовок вкладки)`})
			}
		}
		if a, ok := m["addLabel"]; ok {
			if _, ok := a.(string); !ok {
				issues = append(issues, Issue{p + "/addLabel", `Поле "addLabel" должно быть строкой (текст пункта «Добавить ...»)`})
			}
		}
		items, _ := m["items"].(string)
		if items == "" || !strings.HasPrefix(items, "/") {
			issues = append(issues, Issue{p + "/items", `Укажите "items": JSON pointer на массив в values, например "/gateways/0/listeners"`})
		} else if schema != nil && !pointerResolves(items, schema, schema) {
			issues = append(issues, Issue{p + "/items", fmt.Sprintf("Путь %q не находит массив в values.schema.json", items)})
		}
		form, _ := m["form"].(string)
		switch form {
		case "":
			issues = append(issues, Issue{p + "/form", `Укажите "form": id формы элемента из блока "views"`})
		case "order":
			issues = append(issues, Issue{p + "/form", `View "order" это форма заказа, она не подходит как форма элемента`})
		default:
			if _, ok := viewsMap[form]; !ok {
				issues = append(issues, Issue{p + "/form", fmt.Sprintf("View %q нет в блоке \"views\"", form)})
			}
		}
		if t, ok := m["ui:table"]; ok {
			issues = append(issues, validateUITable(p+"/ui:table", t)...)
		}
		if e, ok := m["enums"]; ok {
			issues = append(issues, validateEnums(p+"/enums", e, schema)...)
		}
	}
	return issues, ids
}

// validateEnums проверяет динамические enum'ы вкладки: массив правил
// {at, from, value}. at - JSON pointer на поле внутри элемента; from - JSON
// pointer на массив-источник в values; value - имя поля строки источника,
// дающее значение опции.
func validateEnums(path string, raw any, schema map[string]any) []Issue {
	arr, ok := raw.([]any)
	if !ok {
		return []Issue{{path, `Блок "enums" должен быть массивом правил: [{"at": "...", "from": "...", "value": "..."}]`}}
	}
	var issues []Issue
	for i, it := range arr {
		p := fmt.Sprintf("%s/%d", path, i)
		m, ok := it.(map[string]any)
		if !ok {
			issues = append(issues, Issue{p, `Правило enum должно быть объектом {"at": "...", "from": "...", "value": "..."}`})
			continue
		}
		for k := range m {
			switch k {
			case "at", "from", "value":
			default:
				issues = append(issues, Issue{p + "/" + k,
					fmt.Sprintf("Лишнее поле %q: в правиле enum допустимы \"at\", \"from\", \"value\"", k)})
			}
		}
		if s, _ := m["at"].(string); s == "" || !strings.HasPrefix(s, "/") {
			issues = append(issues, Issue{p + "/at",
				`Укажите "at": JSON pointer на поле внутри элемента, например "/parentRefs/0/sectionName"`})
		}
		from, _ := m["from"].(string)
		if from == "" || !strings.HasPrefix(from, "/") {
			issues = append(issues, Issue{p + "/from",
				`Укажите "from": JSON pointer на массив-источник в values, например "/gateways/0/listeners"`})
		} else if schema != nil && !pointerResolves(from, schema, schema) {
			issues = append(issues, Issue{p + "/from",
				fmt.Sprintf("Путь %q не находит массив в values.schema.json", from)})
		}
		if s, _ := m["value"].(string); s == "" {
			issues = append(issues, Issue{p + "/value",
				`Укажите "value": имя поля строки источника, дающее значение опции`})
		}
	}
	return issues
}

// validateColumnLookup проверяет вычисляемую колонку: объект {keys, in, match,
// get}. keys - указатель внутри элемента (может содержать "*"); in - указатель
// на массив в values; match/get - имена полей строки массива.
func validateColumnLookup(path string, raw any) []Issue {
	m, ok := raw.(map[string]any)
	if !ok {
		return []Issue{{path, `Поле "lookup" должно быть объектом {"keys": "...", "in": "...", "match": "...", "get": "..."}`}}
	}
	var issues []Issue
	for k := range m {
		switch k {
		case "keys", "in", "match", "get":
		default:
			issues = append(issues, Issue{path + "/" + k,
				fmt.Sprintf("Лишнее поле %q: в \"lookup\" допустимы \"keys\", \"in\", \"match\", \"get\"", k)})
		}
	}
	if s, _ := m["keys"].(string); s == "" || !strings.HasPrefix(s, "/") {
		issues = append(issues, Issue{path + "/keys",
			`Укажите "keys": JSON pointer внутри элемента, может содержать "*", например "/parentRefs/*/sectionName"`})
	}
	if s, _ := m["in"].(string); s == "" || !strings.HasPrefix(s, "/") {
		issues = append(issues, Issue{path + "/in",
			`Укажите "in": JSON pointer на массив в values, например "/gateways/0/listeners"`})
	}
	if s, _ := m["match"].(string); s == "" {
		issues = append(issues, Issue{path + "/match",
			`Укажите "match": имя поля строки массива для сравнения с ключом`})
	}
	if s, _ := m["get"].(string); s == "" {
		issues = append(issues, Issue{path + "/get",
			`Укажите "get": имя поля строки массива, чьё значение берём`})
	}
	return issues
}

// validateActions проверяет секцию actions. Каждый элемент кладёт форму-view
// (кроме order, она в views) в меню «Действия»: в "info" (вкладка «Общая
// информация») или в "tab:<id>", где <id> это вкладка из блока "tabs".
func validateActions(raw any, viewsMap map[string]any, tabIDs map[string]bool) []Issue {
	arr, ok := raw.([]any)
	if !ok {
		return []Issue{{"/actions", `Блок "actions" должен быть массивом: [{"view": "...", "in": "info"}]`}}
	}
	var issues []Issue
	for i, it := range arr {
		p := fmt.Sprintf("/actions/%d", i)
		m, ok := it.(map[string]any)
		if !ok {
			issues = append(issues, Issue{p, `Элемент actions должен быть объектом {"view": "...", "in": "info" | "tab:<id>"}`})
			continue
		}
		view, _ := m["view"].(string)
		switch view {
		case "":
			issues = append(issues, Issue{p + "/view", `Укажите "view": имя view из блока "views"`})
		case "order":
			issues = append(issues, Issue{p + "/view", `View "order" это форма заказа, её нельзя класть в «Действия»`})
		default:
			if _, ok := viewsMap[view]; !ok {
				issues = append(issues, Issue{p + "/view", fmt.Sprintf("View %q нет в блоке \"views\"", view)})
			}
		}
		if l, ok := m["label"]; ok {
			if _, ok := l.(string); !ok {
				issues = append(issues, Issue{p + "/label", `Поле "label" должно быть строкой (текст пункта в меню «Действия»)`})
			}
		}
		in, _ := m["in"].(string)
		switch {
		case in == "":
			issues = append(issues, Issue{p + "/in", `Укажите "in": "info" или "tab:<id>"`})
		case in == "info":
			// вкладка «Общая информация» есть всегда
		case strings.HasPrefix(in, "tab:"):
			tab := strings.TrimPrefix(in, "tab:")
			if tab == "" {
				issues = append(issues, Issue{p + "/in", `Укажите вкладку: "tab:<id>"`})
			} else if !tabIDs[tab] {
				issues = append(issues, Issue{p + "/in", fmt.Sprintf("Вкладки %q нет в блоке \"tabs\"", tab)})
			}
		default:
			issues = append(issues, Issue{p + "/in", fmt.Sprintf("Неизвестное размещение %q: допустимо \"info\" или \"tab:<id>\"", in)})
		}
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

// validateUITable проверяет колонки списочной вкладки: массив объектов. Колонка
// задаёт либо "path" (имя поля элемента), либо "lookup" (вычисляемое значение
// через join по ссылке). label опционален для path-колонки (по умолчанию равен
// path) и обязателен для lookup-колонки.
func validateUITable(path string, raw any) []Issue {
	arr, ok := raw.([]any)
	if !ok {
		return []Issue{{path, `Поле "ui:table" должно быть массивом колонок: [{"path": "name", "label": "Имя"}]`}}
	}
	var issues []Issue
	for i, it := range arr {
		p := fmt.Sprintf("%s/%d", path, i)
		m, ok := it.(map[string]any)
		if !ok {
			issues = append(issues, Issue{p, `Колонка должна быть объектом {"path": "...", "label": "..."}`})
			continue
		}
		if lk, ok := m["lookup"]; ok {
			issues = append(issues, validateColumnLookup(p+"/lookup", lk)...)
			if s, ok := m["label"].(string); !ok || s == "" {
				issues = append(issues, Issue{p + "/label", `Для вычисляемой колонки укажите "label" (заголовок)`})
			}
		} else if s, ok := m["path"].(string); !ok || s == "" {
			issues = append(issues, Issue{p + "/path", `Укажите "path": имя поля элемента, например "name", либо задайте "lookup"`})
		}
		if l, ok := m["label"]; ok {
			if _, ok := l.(string); !ok {
				issues = append(issues, Issue{p + "/label", `Поле "label" должно быть строкой`})
			}
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

// resolvePointerNode возвращает узел схемы, на который указывает JSON pointer по
// values (например /gateways/0/listeners, узел массива listeners), или nil, если
// путь не находится или схема дальше не описана.
func resolvePointerNode(ptr string, node, root map[string]any) map[string]any {
	cur := deref(node, root)
	for seg := range strings.SplitSeq(strings.TrimPrefix(ptr, "/"), "/") {
		if cur == nil {
			return nil
		}
		if isIndex(seg) {
			items, _ := cur["items"].(map[string]any)
			if items == nil {
				return nil
			}
			cur = deref(items, root)
			continue
		}
		props := collectProperties(cur, root)
		if props == nil {
			return nil
		}
		next, ok := props[seg].(map[string]any)
		if !ok {
			return nil
		}
		cur = deref(next, root)
	}
	return cur
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
