package views_test

import (
	"strings"
	"testing"

	"idp/internal/views"
)

// Схема в духе реального ingress-gateway: definitions + $ref + вложенность.
const schema = `{
  "type": "object",
  "properties": {
    "naming": { "type": "object", "properties": { "env": { "type": "string" } } },
    "gateways": { "type": "array", "items": { "$ref": "#/definitions/gateway" } },
    "xroutes": { "type": "array", "items": { "$ref": "#/definitions/xroute" } }
  },
  "definitions": {
    "gateway": {
      "type": "object",
      "properties": {
        "name": { "type": "string" },
        "listeners": { "type": "array", "items": { "type": "object" } },
        "resources": { "type": "object" },
        "hpa": { "type": "object" }
      }
    },
    "xroute": {
      "type": "object",
      "properties": {
        "enabled": { "type": "boolean" },
        "hostnames": { "type": "array", "items": { "type": "string" } },
        "parentRefs": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": { "gateway": { "type": "string" }, "sectionName": { "type": "string" } }
          }
        }
      }
    }
  }
}`

const validDoc = `{
  "$comment": "ок",
  "views": {
    "order": {
      "identity": "/gateways/0/name",
      "include": ["naming", "gateways"],
      "overrides": {
        "gateways": {
          "ui:widget": "single",
          "title": "Gateway",
          "ui:view": { "exclude": ["hpa"] }
        }
      }
    },
    "routes": {
      "include": ["xroutes"],
      "overrides": {
        "xroutes": {
          "ui:view": {
            "exclude": ["enabled", "hostnames"],
            "overrides": { "parentRefs": { "ui:view": { "exclude": ["gateway"] } } }
          }
        }
      }
    }
  }
}`

func hasIssue(issues []views.Issue, pathPart, msgPart string) bool {
	for _, is := range issues {
		if strings.Contains(is.Path, pathPart) && strings.Contains(is.Message, msgPart) {
			return true
		}
	}
	return false
}

func TestValidDocument(t *testing.T) {
	if issues := views.Validate([]byte(validDoc), []byte(schema)); len(issues) > 0 {
		t.Fatalf("want no issues, got %+v", issues)
	}
}

func TestStructuralIssues(t *testing.T) {
	cases := []struct {
		name, doc, path, msg string
	}{
		{"broken json", `{broken`, "", "невалидный JSON"},
		{"no views", `{"version":1}`, "", `"views"`},
		{"views not object", `{"views":[]}`, "/views", "объект"},
		{"unknown root key", `{"views":{"order":{}},"viws":{}}`, "/viws", "неизвестное"},
		{"unknown view key", `{"views":{"order":{"includ":["x"]}}}`, "/views/order/includ", "неизвестное"},
		{"include not array", `{"views":{"order":{"include":"naming"}}}`, "/views/order/include", "массивом"},
		{"bad widget", `{"views":{"order":{"overrides":{"x":{"ui:widget":"fancy"}}}}}`, "ui:widget", "single"},
		{"identity not pointer", `{"views":{"order":{"identity":"gateways"}}}`, "/identity", "pointer"},
		{"identity nested", `{"views":{"order":{"overrides":{"x":{"ui:view":{"identity":"/a"}}}}}}`, "ui:view/identity", "верхнем уровне"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			issues := views.Validate([]byte(c.doc), nil)
			if !hasIssue(issues, c.path, c.msg) {
				t.Fatalf("want issue %q at %q, got %+v", c.msg, c.path, issues)
			}
		})
	}
}

func TestSchemaCrossChecks(t *testing.T) {
	cases := []struct {
		name, doc, path, msg string
	}{
		{
			"include unknown field",
			`{"views":{"order":{"include":["naming","nope"]}}}`,
			"/views/order/include/1", "отсутствует в схеме",
		},
		{
			"override unknown field",
			`{"views":{"order":{"overrides":{"nope":{"title":"x"}}}}}`,
			"/views/order/overrides/nope", "отсутствует в схеме",
		},
		{
			"nested exclude unknown (через $ref и массив)",
			`{"views":{"order":{"overrides":{"gateways":{"ui:view":{"exclude":["nope"]}}}}}}`,
			"ui:view/exclude/0", "отсутствует в схеме",
		},
		{
			"identity unresolved",
			`{"views":{"order":{"identity":"/gateways/0/nope"}}}`,
			"/identity", "не находит",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			issues := views.Validate([]byte(c.doc), []byte(schema))
			if !hasIssue(issues, c.path, c.msg) {
				t.Fatalf("want issue %q at %q, got %+v", c.msg, c.path, issues)
			}
		})
	}
}

// Без схемы (чарт без values.schema.json) кросс-проверки молчат.
func TestNoSchemaSkipsCrossChecks(t *testing.T) {
	doc := `{"views":{"order":{"identity":"/whatever/0/x","include":["anything"]}}}`
	if issues := views.Validate([]byte(doc), nil); len(issues) > 0 {
		t.Fatalf("want no issues without schema, got %+v", issues)
	}
}

// Free-form участки схемы (объект без properties) не дают ложных ошибок.
func TestFreeFormObjectTolerated(t *testing.T) {
	loose := `{"type":"object","properties":{"cfg":{"type":"object"}}}`
	doc := `{"views":{"order":{"overrides":{"cfg":{"ui:view":{"include":["whatever"]}}}}}}`
	if issues := views.Validate([]byte(doc), []byte(loose)); len(issues) > 0 {
		t.Fatalf("want no issues on free-form object, got %+v", issues)
	}
}
