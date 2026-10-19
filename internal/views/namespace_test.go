package views

import (
	"errors"
	"reflect"
	"testing"
)

func TestOrderNamespace(t *testing.T) {
	cases := []struct {
		name string
		view string
		want string
	}{
		{"declared", `{"views":{"order":{"namespace":"/namespace/namespaceName"}}}`, "/namespace/namespaceName"},
		{"absent", `{"views":{"order":{"identity":"/x"}}}`, ""},
		{"no order view", `{"views":{"info":{"namespace":"/x"}}}`, ""},
		{"malformed json", `{`, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := OrderNamespace([]byte(c.view)); got != c.want {
				t.Fatalf("OrderNamespace = %q, want %q", got, c.want)
			}
		})
	}
}

func TestBindNamespace(t *testing.T) {
	view := []byte(`{"views":{"order":{"namespace":"/namespace/namespaceName"}}}`)

	t.Run("overwrites existing value and creates parents", func(t *testing.T) {
		values := map[string]any{"namespace": map[string]any{"namespaceName": "stale", "creator": "lk"}}
		out := BindNamespace(values, view, "team-alpha")
		ns := out["namespace"].(map[string]any)
		if ns["namespaceName"] != "team-alpha" {
			t.Fatalf("namespaceName = %v, want team-alpha", ns["namespaceName"])
		}
		if ns["creator"] != "lk" {
			t.Fatalf("sibling key must be untouched, got %v", ns["creator"])
		}
	})

	t.Run("creates the field when absent", func(t *testing.T) {
		out := BindNamespace(map[string]any{}, view, "team-alpha")
		ns, _ := out["namespace"].(map[string]any)
		if ns == nil || ns["namespaceName"] != "team-alpha" {
			t.Fatalf("namespaceName not set, got %v", out)
		}
	})

	t.Run("no-op without a binding", func(t *testing.T) {
		out := BindNamespace(map[string]any{"a": 1}, []byte(`{"views":{"order":{}}}`), "team-alpha")
		if _, ok := out["namespace"]; ok {
			t.Fatalf("must not touch values when no namespace binding declared")
		}
	})

	t.Run("no-op on empty namespace", func(t *testing.T) {
		values := map[string]any{"namespace": map[string]any{"namespaceName": "keep"}}
		out := BindNamespace(values, view, "")
		ns := out["namespace"].(map[string]any)
		if ns["namespaceName"] != "keep" {
			t.Fatalf("empty namespace must not overwrite, got %v", ns["namespaceName"])
		}
	})

	t.Run("nil values map", func(t *testing.T) {
		out := BindNamespace(nil, view, "team-alpha")
		ns, _ := out["namespace"].(map[string]any)
		if ns == nil || ns["namespaceName"] != "team-alpha" {
			t.Fatalf("namespaceName not set on nil input, got %v", out)
		}
	})

	t.Run("no-op on object (non-mirror) form", func(t *testing.T) {
		objView := []byte(`{"views":{"order":{"namespace":{"source":"values","pointer":"/namespace/namespaceName"}}}}`)
		out := BindNamespace(map[string]any{}, objView, "team-alpha")
		if _, ok := out["namespace"]; ok {
			t.Fatalf("object form must not mirror via BindNamespace")
		}
	})
}

func TestOrderNamespaceRule(t *testing.T) {
	cases := []struct {
		name string
		view string
		want NamespaceRule
	}{
		{"absent", `{"views":{"order":{"identity":"/x"}}}`, NamespaceRule{}},
		{"legacy string keeps field source", `{"views":{"order":{"namespace":"/namespace/namespaceName"}}}`,
			NamespaceRule{Source: NamespaceSourceField}},
		{"values object", `{"views":{"order":{"namespace":{"source":"values","pointer":"/namespace/namespaceName","hideOrderField":true}}}}`,
			NamespaceRule{Source: NamespaceSourceValues, Pointer: "/namespace/namespaceName", HideOrderField: true}},
		{"fixed object", `{"views":{"order":{"namespace":{"source":"fixed","value":"platform-system","hideOrderField":true}}}}`,
			NamespaceRule{Source: NamespaceSourceFixed, Value: "platform-system", HideOrderField: true}},
		{"empty source defaults to field", `{"views":{"order":{"namespace":{"hideOrderField":true}}}}`,
			NamespaceRule{Source: NamespaceSourceField, HideOrderField: true}},
		{"malformed json", `{`, NamespaceRule{}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := OrderNamespaceRule([]byte(c.view))
			if got != c.want {
				t.Fatalf("OrderNamespaceRule = %+v, want %+v", got, c.want)
			}
		})
	}
}

func TestResolveDestinationNamespace(t *testing.T) {
	values := map[string]any{"namespace": map[string]any{"namespaceName": "team-alpha"}}
	cases := []struct {
		name    string
		rule    NamespaceRule
		orderNS string
		want    string
	}{
		{"field returns the form input", NamespaceRule{Source: NamespaceSourceField}, "picked", "picked"},
		{"empty source returns the form input", NamespaceRule{}, "picked", "picked"},
		{"values reads the pointer", NamespaceRule{Source: NamespaceSourceValues, Pointer: "/namespace/namespaceName"}, "ignored", "team-alpha"},
		{"values missing pointer yields empty", NamespaceRule{Source: NamespaceSourceValues, Pointer: "/namespace/absent"}, "ignored", ""},
		{"fixed returns the constant", NamespaceRule{Source: NamespaceSourceFixed, Value: "platform-system"}, "ignored", "platform-system"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := ResolveDestinationNamespace(c.rule, c.orderNS, values, TemplateData{})
			if err != nil || got != c.want {
				t.Fatalf("ResolveDestinationNamespace = %q, %v; want %q", got, err, c.want)
			}
		})
	}
}

// The case the template source exists for: the namespace chart builds the name
// from the project, the cluster and the purpose, and the portal has to land the
// order in the namespace that really appears, not in the purpose alone.
func TestResolveDestinationNamespaceTemplate(t *testing.T) {
	view := `{"views":{"order":{"namespace":{"source":"template","hideOrderField":true,` +
		`"template":"{{.Team}}-{{.Values.global.identity.cluster}}-ns-{{ .Values.global.namespacePurpose }}"}}}}`
	rule := OrderNamespaceRule([]byte(view))
	if rule.Source != NamespaceSourceTemplate || !rule.HideOrderField || rule.Template == "" {
		t.Fatalf("OrderNamespaceRule = %+v", rule)
	}
	values := map[string]any{"global": map[string]any{
		"identity":         map[string]any{"cluster": "dev"},
		"namespacePurpose": "app",
	}}
	got, err := ResolveDestinationNamespace(rule, "ignored", values, TemplateData{Team: "nbox"})
	if err != nil || got != "nbox-dev-ns-app" {
		t.Fatalf("ResolveDestinationNamespace = %q, %v; want nbox-dev-ns-app", got, err)
	}
}

func TestRenderNamespaceTemplate(t *testing.T) {
	values := map[string]any{
		"my-key":  map[string]any{"x": "keyed"},
		"replica": float64(3),
		"on":      true,
		"name":    "svc",
		"empty":   "",
		"obj":     map[string]any{"a": "b"},
	}
	data := TemplateData{
		Team: "t", ServiceName: "s", Cluster: "c", Chart: "ch",
		Vars: map[string]string{"OPS": "ops", "BLANK": ""}, Stand: "prod",
	}
	ok := []struct{ tmpl, want string }{
		{`{{index .Values "my-key" "x"}}-{{.Values.name}}`, "keyed-svc"},
		{`r{{.Values.replica}}-{{.Values.on}}`, "r3-true"},
		{`{{.Team}}.{{.ServiceName}}.{{.Cluster}}.{{.Chart}}.{{.Vars.OPS}}`, "t.s.c.ch.ops"},
	}
	for _, c := range ok {
		got, err := RenderNamespaceTemplate(c.tmpl, data, values)
		if err != nil || got != c.want {
			t.Errorf("%s: got %q, %v; want %q", c.tmpl, got, err, c.want)
		}
	}

	var field *NamespaceValueError
	for _, tmpl := range []string{`{{.Values.empty}}`, `{{.Values.absent.deeper}}`, `{{.Values.name.under}}`} {
		if _, err := RenderNamespaceTemplate(tmpl, data, values); !errors.As(err, &field) {
			t.Errorf("%s: want a NamespaceValueError, got %v", tmpl, err)
		}
	}
	var empty *VarEmptyError
	if _, err := RenderNamespaceTemplate(`{{.Vars.BLANK}}`, data, values); !errors.As(err, &empty) {
		t.Errorf("empty variable: want a VarEmptyError, got %v", err)
	}
	for _, tmpl := range []string{
		`{{.Values.obj}}`,         // not a scalar
		`{{.Values}}`,             // the values as a whole
		`{{.Namespace}}`,          // what the template computes
		`{{.ChartVersion}}`,       // moves on an upgrade
		`{{.User.Name}}`,          // moves with whoever saved last
		`{{.Nope}}`,               // nobody answers to it
		`{{index .Values "a" b}}`, // a key without quotes
		`{{if .Team}}x{{end}}`,    // not in the dialect
		`plain-{{ $labels.x }}`,   // passes through a value, never a name
	} {
		if _, err := RenderNamespaceTemplate(tmpl, data, values); err == nil {
			t.Errorf("%s: want an error", tmpl)
		} else if errors.As(err, &field) {
			t.Errorf("%s: a document mistake must not read as an empty field: %v", tmpl, err)
		}
	}
}

func TestCheckNamespaceTemplate(t *testing.T) {
	known := KnownVars{"OPS": "ops"}
	for _, tmpl := range []string{
		`{{.Values.a.b}}-{{index .Values "x-y"}}-{{.Team}}-{{.Vars.OPS}}`,
		`{{.ServiceName}}-{{.Cluster}}-{{.Chart}}`,
	} {
		if err := CheckNamespaceTemplate(tmpl, known); err != nil {
			t.Errorf("%s: %v", tmpl, err)
		}
	}
	for _, tmpl := range []string{`{{.Vars.MISSING}}`, `{{.Namespace}}`, `{{.User.Subject}}`, `{{.Values}}`} {
		if err := CheckNamespaceTemplate(tmpl, known); err == nil {
			t.Errorf("%s: want an error", tmpl)
		}
	}
	got := NamespaceTemplateFields(`{{.Values.a.b}}-{{index .Values "x-y" "z"}}-{{.Team}}`)
	want := [][]string{{"a", "b"}, {"x-y", "z"}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("NamespaceTemplateFields = %v, want %v", got, want)
	}
}

// The index form joins the dialect everywhere, not only in the namespace: the
// same "{{index .User "Name"}}" reads in "defaults" as its dotted form does, and
// ".Values" stays unknown there.
func TestIndexFormInDefaults(t *testing.T) {
	got, err := RenderTemplate(`{{index .User "Name"}}`, TemplateData{User: TemplateUser{Name: "Ann"}})
	if err != nil || got != "Ann" {
		t.Fatalf("index form: %q, %v", got, err)
	}
	if err := CheckTemplate(`{{index .Values "a"}}`, nil); err == nil {
		t.Fatal(".Values in defaults: want an error")
	}
	if got := VariablesUsed([]byte(`{"views":{"order":{"namespace":{"source":"template","template":"{{.Vars.NS}}-x"}}}}`)); !reflect.DeepEqual(got, []string{"NS"}) {
		t.Fatalf("VariablesUsed = %v, want [NS]", got)
	}
}
