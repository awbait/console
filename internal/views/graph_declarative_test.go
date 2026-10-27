package views_test

import (
	"encoding/json"
	"strings"
	"testing"

	"console/internal/views"
)

const declarativeDocument = `{"views":{"order":{},"node":{"include":["name"]}},"graph":{"profile":"declarative","version":1,"nodes":{"broker":{"collection":"/brokers","key":"/name","form":"node"}},"relations":{"subscription":{"collection":"/subscriptions","key":"/name","from":{"node":"broker","field":"/from"},"to":{"node":"broker","field":"/to"}}}}}`
const declarativeSchema = `{"type":"object","properties":{"brokers":{"type":"array","items":{"$ref":"#/definitions/node"}},"subscriptions":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"from":{"type":"string"},"to":{"type":"string"}}}}},"definitions":{"node":{"type":"object","properties":{"name":{"type":"string"}}}}}`

func TestDeclarativeGraphDefinition(t *testing.T) {
	if issues := views.Validate([]byte(declarativeDocument), []byte(declarativeSchema)); len(issues) != 0 {
		t.Fatalf("valid graph: %+v", issues)
	}
	for _, tc := range []struct{ name, old, replacement string }{
		{"version", `"version":1`, `"version":2`},
		{"missing node kind", `"node":"broker"`, `"node":"missing"`},
		{"invalid collection", `"collection":"/brokers"`, `"collection":"/missing"`},
		{"unknown key", `"key":"/name"`, `"key":"/missing"`},
		{"form", `"form":"node"`, `"form":"order"`},
		{"overlap", `"collection":"/subscriptions"`, `"collection":"/brokers"`},
		{"unsafe pointer", `"key":"/name"`, `"key":"/__proto__/name"`},
		{"overlapping endpoints", `"field":"/to"`, `"field":"/from"`},
		{"key endpoint overlap", `"field":"/from"`, `"field":"/name"`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			doc := strings.Replace(declarativeDocument, tc.old, tc.replacement, 1)
			if got := views.Validate([]byte(doc), []byte(declarativeSchema)); len(got) == 0 {
				t.Fatal("invalid mapping accepted")
			}
		})
	}
}

func TestDeclarativeGraphEscapedPaths(t *testing.T) {
	doc := strings.ReplaceAll(declarativeDocument, `"/brokers"`, `"/mesh~1brokers"`)
	schema := strings.ReplaceAll(declarativeSchema, `"brokers":`, `"mesh/brokers":`)
	if got := views.Validate([]byte(doc), []byte(schema)); len(got) != 0 {
		t.Fatalf("escaped path: %+v", got)
	}
}

func TestDeclarativeGraphValues(t *testing.T) {
	for _, tc := range []struct {
		name, values string
		valid        bool
	}{
		{"empty", `{}`, true},
		{"unlinked node", `{"brokers":[{"name":"main"}]}`, true},
		{"self edge", `{"brokers":[{"name":"main"}],"subscriptions":[{"name":"sub","from":"main","to":"main"}]}`, true},
		{"dangling", `{"brokers":[{"name":"main"}],"subscriptions":[{"name":"sub","from":"missing","to":"main"}]}`, false},
		{"duplicate", `{"brokers":[{"name":"main"},{"name":"main"}]}`, false},
		{"numeric key", `{"brokers":[{"name":42}]}`, false},
		{"bad list", `{"brokers":{}}`, false},
		{"null list", `{"brokers":null}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var values map[string]any
			if err := json.Unmarshal([]byte(tc.values), &values); err != nil {
				t.Fatal(err)
			}
			before, _ := json.Marshal(values)
			issues := views.ValidateGraphValues([]byte(declarativeDocument), values)
			if (len(issues) == 0) != tc.valid {
				t.Fatalf("valid=%v issues=%+v", tc.valid, issues)
			}
			after, _ := json.Marshal(values)
			if string(before) != string(after) {
				t.Fatal("validation mutated values")
			}
		})
	}
}
