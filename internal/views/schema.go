package views

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v5"
)

// documentSchemaJSON is the shape of a view document, written once and read
// twice: the portal validates against it here, and hands the same bytes to the
// editor in the version constructor, which turns them into completion, hovers
// and squiggles. Everything this file checks is therefore already known to the
// person typing, before they press anything.
//
// What stays in validate.go is what a static schema cannot say: whether a
// pointer finds a field in THIS chart's values.schema.json, whether a tab id is
// unique, whether a form named by a tab exists, and the graph/namespace
// directives, whose allowed keys depend on a profile the portal implements.
//
//go:embed document.schema.json
var documentSchemaJSON []byte

// DocumentSchema returns the JSON Schema of the view document. The bytes are
// embedded, so the caller must not modify them.
func DocumentSchema() []byte { return documentSchemaJSON }

// Annotations the schema carries for the portal, alongside "errorMessage" (which
// the editor's JSON language service reads too):
//
//	x-extraMessage   - what to say about a key the object does not allow;
//	                   "{key}" in it is replaced by the quoted key.
//	x-missingMessage - what to say when a required property is absent. Without
//	                   it the property's own errorMessage is used.
const (
	annError   = "errorMessage"
	annExtra   = "x-extraMessage"
	annMissing = "x-missingMessage"
)

var (
	documentSchema    = mustCompileDocumentSchema()
	documentSchemaRaw = mustDecodeDocumentSchema()
)

func mustCompileDocumentSchema() *jsonschema.Schema {
	c := jsonschema.NewCompiler()
	c.Draft = jsonschema.Draft7
	if err := c.AddResource("view-document.schema.json", strings.NewReader(string(documentSchemaJSON))); err != nil {
		panic("views: embedded document schema is not JSON: " + err.Error())
	}
	sch, err := c.Compile("view-document.schema.json")
	if err != nil {
		panic("views: embedded document schema does not compile: " + err.Error())
	}
	return sch
}

func mustDecodeDocumentSchema() map[string]any {
	var m map[string]any
	if err := json.Unmarshal(documentSchemaJSON, &m); err != nil {
		panic("views: embedded document schema is not JSON: " + err.Error())
	}
	return m
}

// checkShape validates the document against the embedded schema and turns the
// failures into issues the constructor can show: one per problem, at the place
// in the document where it is, worded the way the schema words it.
func checkShape(doc any) []Issue {
	err := documentSchema.Validate(doc)
	if err == nil {
		return nil
	}
	ve, ok := err.(*jsonschema.ValidationError)
	if !ok {
		// Not a validation failure but a broken evaluation; the document is not
		// to blame, and the cross-checks below still have something to say.
		return nil
	}
	var issues []Issue
	seen := map[Issue]bool{}
	add := func(is Issue) {
		if !seen[is] {
			seen[is] = true
			issues = append(issues, is)
		}
	}
	var walk func(e *jsonschema.ValidationError)
	walk = func(e *jsonschema.ValidationError) {
		if len(e.Causes) > 0 {
			for _, c := range e.Causes {
				walk(c)
			}
			return
		}
		for _, is := range explain(doc, e) {
			add(is)
		}
	}
	walk(ve)
	return issues
}

// explain turns one leaf failure into the issues a person can act on. Most
// failures are one issue at the failing value; "required" and
// "additionalProperties" speak about keys, so they are reported at the key.
func explain(doc any, e *jsonschema.ValidationError) []Issue {
	keyword := lastSegment(e.KeywordLocation)
	owner, _ := resolveKeyword(parentLocation(e.KeywordLocation)).(map[string]any)
	inst := unescapePointer(e.InstanceLocation)

	switch keyword {
	case "required":
		var issues []Issue
		for _, key := range missingProperties(doc, e) {
			issues = append(issues, Issue{
				Path:    inst + "/" + key,
				Message: propertyMessage(e.KeywordLocation, key, annMissing),
			})
		}
		return issues
	case "additionalProperties":
		var issues []Issue
		for _, key := range extraProperties(doc, e.InstanceLocation, owner) {
			msg, _ := owner[annExtra].(string)
			if msg == "" {
				msg = "Лишнее поле {key}"
			}
			issues = append(issues, Issue{
				Path:    inst + "/" + key,
				Message: strings.ReplaceAll(msg, "{key}", strconv.Quote(key)),
			})
		}
		return issues
	}
	msg, _ := owner[annError].(string)
	if msg == "" {
		msg = defaultMessage(keyword, owner)
	}
	return []Issue{{Path: inst, Message: msg}}
}

// defaultMessage is what a subschema without an "errorMessage" says. Every
// message a person is meant to read is written in the schema; this is the
// backstop for a rule added there without one.
func defaultMessage(keyword string, owner map[string]any) string {
	switch keyword {
	case "type":
		if t := typeNames(owner["type"]); t != "" {
			return "Здесь ожидается " + t
		}
	case "enum", "const":
		if list := enumValues(owner); list != "" {
			return "Допустимые значения: " + list
		}
	case "not":
		return "Это поле здесь не допускается"
	}
	return "Значение не подходит под формат документа"
}

// propertyMessage finds what the schema says about one property by name. The
// "required" keyword often sits in a branch of its own (an if/then), so the
// search walks up the keyword location until it meets the object that describes
// the property.
func propertyMessage(keywordLocation, key, annotation string) string {
	for loc := keywordLocation; ; loc = parentLocation(loc) {
		node, _ := resolveKeyword(loc).(map[string]any)
		if props, ok := node["properties"].(map[string]any); ok {
			if p, ok := props[key].(map[string]any); ok {
				if m, _ := p[annotation].(string); m != "" {
					return m
				}
				if m, _ := p[annError].(string); m != "" {
					return m
				}
			}
		}
		if loc == "" {
			return fmt.Sprintf("Не хватает поля %q", key)
		}
	}
}

// missingProperties lists the required properties the instance does not have.
// Reading them off the schema keeps the reported keys exact: the library states
// the same thing in one English sentence, which would have to be parsed back.
func missingProperties(doc any, e *jsonschema.ValidationError) []string {
	list, _ := resolveKeyword(e.KeywordLocation).([]any)
	obj, _ := instanceAt(doc, e.InstanceLocation).(map[string]any)
	var missing []string
	for _, it := range list {
		key, _ := it.(string)
		if key == "" {
			continue
		}
		if _, ok := obj[key]; !ok {
			missing = append(missing, key)
		}
	}
	return missing
}

// extraProperties lists the instance keys the object schema does not describe.
func extraProperties(doc any, instanceLocation string, owner map[string]any) []string {
	obj, _ := instanceAt(doc, instanceLocation).(map[string]any)
	props, _ := owner["properties"].(map[string]any)
	var extra []string
	for key := range obj {
		if _, ok := props[key]; !ok {
			extra = append(extra, key)
		}
	}
	sort.Strings(extra) // map order, and issues are compared in tests
	return extra
}

// resolveKeyword walks a keyword location (the path the library reports inside
// the schema, e.g. /properties/views/additionalProperties/$ref/properties/include/type)
// down the raw schema document, following "$ref" as it goes.
func resolveKeyword(location string) any {
	cur := any(documentSchemaRaw)
	for _, seg := range strings.Split(strings.TrimPrefix(location, "/"), "/") {
		if seg == "" {
			continue
		}
		if seg == "$ref" {
			m, ok := cur.(map[string]any)
			if !ok {
				return nil
			}
			ref, _ := m["$ref"].(string)
			cur = instanceAt(documentSchemaRaw, strings.TrimPrefix(ref, "#"))
			continue
		}
		switch n := cur.(type) {
		case map[string]any:
			cur = n[unescapePointer(seg)]
		case []any:
			i, err := strconv.Atoi(seg)
			if err != nil || i < 0 || i >= len(n) {
				return nil
			}
			cur = n[i]
		default:
			return nil
		}
	}
	return cur
}

// instanceAt returns the value a JSON pointer points to inside a decoded document.
func instanceAt(doc any, pointer string) any {
	cur := doc
	for _, seg := range strings.Split(strings.TrimPrefix(pointer, "/"), "/") {
		if seg == "" {
			continue
		}
		seg = unescapePointer(seg)
		switch n := cur.(type) {
		case map[string]any:
			cur = n[seg]
		case []any:
			i, err := strconv.Atoi(seg)
			if err != nil || i < 0 || i >= len(n) {
				return nil
			}
			cur = n[i]
		default:
			return nil
		}
	}
	return cur
}

func parentLocation(location string) string {
	i := strings.LastIndex(location, "/")
	if i < 0 {
		return ""
	}
	return location[:i]
}

func lastSegment(location string) string {
	i := strings.LastIndex(location, "/")
	if i < 0 {
		return location
	}
	return location[i+1:]
}

// unescapePointer spells a JSON pointer out for a person: "~1" and "~0" stand
// for "/" and "~", and a path in the constructor is read, not dereferenced.
func unescapePointer(s string) string {
	return strings.NewReplacer("~1", "/", "~0", "~").Replace(s)
}

func typeNames(raw any) string {
	names := map[string]string{
		"object": "объект", "array": "массив", "string": "строка",
		"number": "число", "integer": "целое число", "boolean": "true или false", "null": "null",
	}
	switch t := raw.(type) {
	case string:
		return names[t]
	case []any:
		var out []string
		for _, it := range t {
			s, _ := it.(string)
			if n := names[s]; n != "" {
				out = append(out, n)
			}
		}
		return strings.Join(out, " или ")
	}
	return ""
}

func enumValues(owner map[string]any) string {
	list, ok := owner["enum"].([]any)
	if !ok {
		if c, ok := owner["const"]; ok {
			list = []any{c}
		} else {
			return ""
		}
	}
	var out []string
	for _, it := range list {
		out = append(out, fmt.Sprintf("%v", it))
	}
	return strings.Join(out, ", ")
}
