package views_test

import (
	"encoding/json"
	"strings"
	"testing"

	"console/internal/views"
)

const areaDocument = `{"views":{"order":{},"area":{"include":["name","owner"]}},"graph":{"profile":"declarative","version":1,"groups":{"namespace":{"collection":"/namespaces","key":"/name","form":"area","accepts":["broker"],"acceptsField":"/allowedKinds"}},"nodes":{"broker":{"collection":"/brokers","key":"/name","group":{"type":"namespace","field":"/namespace"}}},"relations":{}}}`
const areaSchema = `{"type":"object","properties":{"namespaces":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"owner":{"type":"string"},"allowedKinds":{"type":"array","items":{"type":"string"}}}}},"brokers":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"namespace":{"type":"string"}}}}}}`

func TestGraphAreaDefinition(t *testing.T) {
	if issues := views.Validate([]byte(areaDocument), []byte(areaSchema)); len(issues) != 0 {
		t.Fatalf("valid: %+v", issues)
	}
	for _, pair := range [][2]string{
		{`"accepts":["broker"]`, `"accepts":["missing"]`},
		{`"type":"namespace"`, `"type":"missing"`},
		{`"field":"/namespace"`, `"field":"/name"`},
		{`"acceptsField":"/allowedKinds"`, `"acceptsField":"/owner"`},
		{`"acceptsField":"/allowedKinds"`, `"acceptsField":"/__proto__/bad"`},
		{`"collection":"/namespaces"`, `"collection":"/brokers"`},
		{`"form":"area"`, `"form":"order"`},
	} {
		doc := strings.Replace(areaDocument, pair[0], pair[1], 1)
		if issues := views.Validate([]byte(doc), []byte(areaSchema)); len(issues) == 0 {
			t.Fatalf("invalid accepted: %s", pair[1])
		}
	}
}

func TestGraphAreaMembership(t *testing.T) {
	for _, tc := range []struct {
		name, values string
		valid        bool
	}{
		{"allowed", `{"namespaces":[{"name":"ns","allowedKinds":["broker"]}],"brokers":[{"name":"a","namespace":"ns"}]}`, true},
		{"absent restriction", `{"namespaces":[{"name":"ns"}],"brokers":[{"name":"a","namespace":"ns"}]}`, true},
		{"empty area", `{"namespaces":[{"name":"ns","owner":"team","allowedKinds":[]}]}`, true},
		{"forbidden", `{"namespaces":[{"name":"ns","allowedKinds":[]}],"brokers":[{"name":"a","namespace":"ns"}]}`, false},
		{"missing area", `{"namespaces":[],"brokers":[{"name":"a","namespace":"ns"}]}`, false},
		{"missing membership", `{"namespaces":[{"name":"ns"}],"brokers":[{"name":"a"}]}`, false},
		{"numeric membership", `{"namespaces":[{"name":"1"}],"brokers":[{"name":"a","namespace":1}]}`, false},
		{"duplicate area", `{"namespaces":[{"name":"ns"},{"name":"ns"}]}`, false},
		{"null list", `{"namespaces":null}`, false},
		{"bad restriction", `{"namespaces":[{"name":"ns","allowedKinds":null}]}`, false},
		{"unknown kind", `{"namespaces":[{"name":"ns","allowedKinds":["secret"]}]}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var values map[string]any
			if err := json.Unmarshal([]byte(tc.values), &values); err != nil {
				t.Fatal(err)
			}
			before, _ := json.Marshal(values)
			issues := views.ValidateGraphValues([]byte(areaDocument), values)
			if (len(issues) == 0) != tc.valid {
				t.Fatalf("valid=%v: %+v", tc.valid, issues)
			}
			after, _ := json.Marshal(values)
			if string(before) != string(after) {
				t.Fatal("validation mutated values")
			}
		})
	}
}
