package views

import (
	"strings"
	"testing"
)

func sampleData() TemplateData {
	return TemplateData{
		Team: "payments", ServiceName: "pg1", Namespace: "nbox-dev-ns-app",
		Cluster: "in-cluster", Chart: "postgres", ChartVersion: "1.2.3",
		User: TemplateUser{Name: "Иванов Иван", Subject: "sub-1"},
	}
}

func TestRenderTemplate(t *testing.T) {
	cases := []struct {
		name, in, want string
	}{
		{"no template", "console", "console"},
		{"whole value", "{{.Team}}", "payments"},
		{"spaces inside braces", "{{ .Team }}", "payments"},
		{"embedded in text", "{{.ServiceName}}.{{.Cluster}}.example.com", "pg1.in-cluster.example.com"},
		{"nested reference", "{{.User.Name}}", "Иванов Иван"},
		{"repeated reference", "{{.Team}}-{{.Team}}", "payments-payments"},
		// A value may legitimately carry somebody else's template: an alert
		// annotation, a dashboard query. Nothing that does not open with "{{."
		// is ours, and it has to come out exactly as it went in.
		{"foreign template", "instance {{ $labels.instance }} down", "instance {{ $labels.instance }} down"},
		{"foreign template before ours", "{{ $labels.job }}/{{.Team}}", "{{ $labels.job }}/payments"},
		{"lone braces", "{{", "{{"},
		// The boundary is the dot: what opens with "{{." is ours and is judged
		// strictly, everything else is somebody else's text and is copied out.
		// A Go action that is not a reference falls on the far side of it.
		{"foreign action", "{{ if .Team }}x{{ end }}", "{{ if .Team }}x{{ end }}"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := RenderTemplate(c.in, sampleData())
			if err != nil {
				t.Fatalf("RenderTemplate(%q): %v", c.in, err)
			}
			if got != c.want {
				t.Fatalf("RenderTemplate(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

// An empty field is an answer ("this order has no namespace of its own"), not a
// mistake: it renders as an empty string and nothing complains.
func TestRenderTemplateEmptyValue(t *testing.T) {
	got, err := RenderTemplate("ns-{{.Namespace}}", TemplateData{})
	if err != nil {
		t.Fatalf("RenderTemplate: %v", err)
	}
	if got != "ns-" {
		t.Fatalf("got %q, want %q", got, "ns-")
	}
}

func TestRenderTemplateRefuses(t *testing.T) {
	cases := []struct{ name, in, wantIn string }{
		{"unknown name", "{{.Teem}}", "нет такой ссылки"},
		{"unknown nested name", "{{.User.Email}}", "нет такой ссылки"},
		{"not closed", "{{.Team", "не закрыта"},
		{"pipeline", "{{ .Team | upper }}", "только ссылка"},
		{"bare dot", "{{ . }}", "только ссылка"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := RenderTemplate(c.in, sampleData())
			if err == nil {
				t.Fatalf("RenderTemplate(%q) must fail", c.in)
			}
			if !strings.Contains(err.Error(), c.wantIn) {
				t.Fatalf("RenderTemplate(%q) said %q, want it to mention %q", c.in, err, c.wantIn)
			}
			// The same document is checked in the constructor, where there is no
			// order to render against: both sides must agree on what is broken.
			if CheckTemplate(c.in) == nil {
				t.Fatalf("CheckTemplate(%q) must fail too", c.in)
			}
		})
	}
}

// The complaint names what to type instead, because the person reading it is
// writing a view document and has just misspelled a reference.
func TestUnknownRefListsWhatExists(t *testing.T) {
	err := CheckTemplate("{{.Teem}}")
	if err == nil {
		t.Fatal("want an error")
	}
	for _, ref := range []string{".Team", ".User.Name"} {
		if !strings.Contains(err.Error(), ref) {
			t.Fatalf("error %q does not offer %q", err, ref)
		}
	}
}

func TestCheckTemplateAccepts(t *testing.T) {
	for _, s := range []string{"console", "{{.Team}}", "{{.User.Subject}}-{{.Chart}}", "{{ $labels.x }}"} {
		if err := CheckTemplate(s); err != nil {
			t.Fatalf("CheckTemplate(%q) = %v, want nil", s, err)
		}
	}
}

// Every reference offered is a reference that resolves: the catalogue is what
// the editor completes from, so an entry nothing answers to would be advice to
// write a broken document.
func TestTemplateRefsAllResolve(t *testing.T) {
	for _, r := range TemplateRefs() {
		if _, ok := sampleData().lookup(r.Ref); !ok {
			t.Fatalf("catalogue offers %q, which nothing resolves", r.Ref)
		}
		if r.Desc == "" {
			t.Fatalf("%q has no description", r.Ref)
		}
	}
}

func TestApplyDefaultsRendersTemplates(t *testing.T) {
	view := []byte(`{"defaults":{"/labels/team":"{{.Team}}","/labels/owner":"{{.User.Name}}","/labels/host":"{{.ServiceName}}.example.com","/labels/fixed":"console","/labels/n":7}}`)
	out, err := ApplyDefaults(map[string]any{}, view, sampleData())
	if err != nil {
		t.Fatalf("ApplyDefaults: %v", err)
	}
	labels := out["labels"].(map[string]any)
	want := map[string]any{
		"team": "payments", "owner": "Иванов Иван",
		"host": "pg1.example.com", "fixed": "console", "n": float64(7),
	}
	for k, v := range want {
		if labels[k] != v {
			t.Fatalf("labels[%q] = %#v, want %#v", k, labels[k], v)
		}
	}
}

// A default that cannot be rendered stops the whole stamp, and the complaint
// names the field: the value would otherwise be committed to Git empty, and
// found much later by somebody wondering what was meant to be there.
func TestApplyDefaultsRefusesBrokenTemplate(t *testing.T) {
	view := []byte(`{"defaults":{"/labels/team":"{{.Teem}}"}}`)
	_, err := ApplyDefaults(map[string]any{}, view, sampleData())
	if err == nil {
		t.Fatal("want an error")
	}
	if !strings.Contains(err.Error(), "/labels/team") {
		t.Fatalf("error %q does not name the field", err)
	}
}

// The version constructor has to catch this while the document is being
// written, with or without the chart's values.schema.json at hand.
func TestValidateFlagsBrokenTemplateInDefaults(t *testing.T) {
	issues := ValidateStructure([]byte(`{"views":{"order":{"identity":"/n"}},"defaults":{"/n/owner":"{{.Teem}}"}}`))
	if len(issues) == 0 {
		t.Fatal("broken template must be flagged")
	}
	if issues[0].Path != "/defaults/n/owner" {
		t.Fatalf("issue path = %q, want /defaults/n/owner", issues[0].Path)
	}
	if ok := ValidateStructure([]byte(`{"views":{"order":{"identity":"/n"}},"defaults":{"/n/owner":"{{.Team}}"}}`)); len(ok) > 0 {
		t.Fatalf("valid template flagged: %+v", ok)
	}
}
