package views_test

import (
	"encoding/json"
	"strings"
	"testing"

	"console/internal/views"
)

// The portal hands these bytes to the editor, which turns them into completion,
// hovers and squiggles. A schema that does not parse would leave the constructor
// with no hints at all, and nothing else would say so.
func TestDocumentSchemaIsUsableJSON(t *testing.T) {
	var doc map[string]any
	if err := json.Unmarshal(views.DocumentSchema(), &doc); err != nil {
		t.Fatalf("document schema is not JSON: %v", err)
	}
	if doc["$schema"] != "http://json-schema.org/draft-07/schema#" {
		t.Fatalf("draft is %v, want draft-07 (what the editor's JSON service reads)", doc["$schema"])
	}
	props, _ := doc["properties"].(map[string]any)
	for _, block := range []string{"views", "tabs", "actions", "defaults", "graph", "approval"} {
		node, _ := props[block].(map[string]any)
		if s, _ := node["description"].(string); s == "" {
			t.Fatalf("block %q has no description, so the editor has nothing to show on hover", block)
		}
	}
}

// A document that uses every block at once, against a schema that has the fields
// it names: the format check must stay silent on it.
func TestFullDocumentValidates(t *testing.T) {
	doc := `{
	  "$comment": "всё сразу",
	  "views": {
	    "order": {
	      "identity": "/gateways/0/name",
	      "namespace": {"source": "fixed", "value": "platform-system", "hideOrderField": true},
	      "include": ["naming", "gateways"],
	      "required": ["naming"],
	      "overrides": {
	        "gateways": {
	          "title": "Gateway",
	          "description": "Точка входа",
	          "ui:widget": "single",
	          "ui:readOnly": false,
	          "ui:view": {"exclude": ["hpa"]}
	        }
	      }
	    },
	    "listener": {}
	  },
	  "tabs": [{
	    "id": "listeners",
	    "title": "Слушатели",
	    "addLabel": "Добавить слушатель",
	    "items": "/gateways/0/listeners",
	    "form": "listener",
	    "ui:table": [{"path": "name", "label": "Имя"}],
	    "enums": [{"at": "/parentRefs/0/sectionName", "from": "/gateways/0/listeners", "value": "name"}]
	  }],
	  "actions": [{"view": "listener", "in": "tab:listeners", "label": "Править"}],
	  "defaults": {"/naming/env": "prod"},
	  "approval": {"autoMerge": false}
	}`
	if issues := views.Validate([]byte(doc), []byte(schema)); len(issues) > 0 {
		t.Fatalf("want no issues, got %+v", issues)
	}
}

// Rules the document schema owns now: shapes that used to be spelled out in Go
// and are read by the editor from the same file.
func TestDocumentSchemaRules(t *testing.T) {
	cases := []struct{ name, doc, path, msg string }{
		{
			"defaults key is not a pointer",
			`{"views":{"order":{}},"defaults":{"naming":"x"}}`,
			"/defaults/naming", "pointer",
		},
		{
			"defaults value is not a scalar",
			`{"views":{"order":{}},"defaults":{"/naming":{"env":"prod"}}}`,
			"/defaults", "скаляром",
		},
		{
			"namespace rule has an extra key",
			`{"views":{"order":{"namespace":{"source":"field","hidden":true}}}}`,
			"/views/order/namespace/hidden", "Лишнее поле",
		},
		{
			"tab items is not a pointer",
			`{"views":{"order":{},"f":{}},"tabs":[{"id":"a","items":"gateways","form":"f"}]}`,
			"/tabs/0/items", `Укажите "items"`,
		},
		{
			"action placement is misspelled",
			`{"views":{"order":{},"f":{}},"actions":[{"view":"f","in":"tab:"}]}`,
			"/actions/0/in", "Неизвестное размещение",
		},
		{
			"graph rename carries a path",
			`{"views":{"order":{}},"graph":{"profile":"policies","entry":{"name":"a/b"}}}`,
			"/graph/entry/name", "без",
		},
		{
			"ui:readOnly is not a boolean",
			`{"views":{"order":{"overrides":{"x":{"ui:readOnly":"yes"}}}}}`,
			"/views/order/overrides/x/ui:readOnly", "true или false",
		},
		{
			"column path is empty",
			`{"views":{"order":{},"f":{}},"tabs":[{"id":"a","items":"/x","form":"f","ui:table":[{"path":""}]}]}`,
			"/tabs/0/ui:table/0/path", `Укажите "path"`,
		},
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

// Every extra key is named, not just the first one the walk happened to reach:
// an author who pasted a block with two typos has to see both.
func TestExtraKeysAreAllReported(t *testing.T) {
	issues := views.Validate([]byte(`{"views":{"order":{}},"tabz":[],"actionz":[]}`), nil)
	for _, key := range []string{"/tabz", "/actionz"} {
		if !hasIssue(issues, key, "Лишнее поле") {
			t.Fatalf("want %q reported, got %+v", key, issues)
		}
	}
}

// Structure first, chart second: a document whose shape is wrong must not also
// be blamed for pointers the portal never got to read.
func TestShapeIssuesDoNotCascade(t *testing.T) {
	issues := views.Validate([]byte(`{"views":{"order":{"include":"naming"}}}`), []byte(schema))
	if len(issues) != 1 {
		t.Fatalf("want the single shape issue, got %+v", issues)
	}
	if !strings.Contains(issues[0].Message, "массивом") {
		t.Fatalf("unexpected message: %q", issues[0].Message)
	}
}
