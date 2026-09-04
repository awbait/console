package views

import (
	"fmt"
	"regexp"
	"strings"
)

// The template dialect of a view document: a reference in double braces, and
// nothing but a reference.
//
// A chart declares order-time values in its "defaults" block, and not all of
// them are fixed. The team an order belongs to, the person who made it, the
// namespace it lands in - the portal knows those, the chart does not. The block
// needs a way to say "whatever the portal has here" instead of a literal.
//
// The shape is the one the portal already speaks in GITLAB_INSTANCE_DIR_TEMPLATE
// ("{{.Chart}}-{{.ServiceName}}"), so whoever has written one recognizes the
// other. What it is not is Go's text/template: no conditions, no loops, no
// pipelines, no functions. The subset is deliberate. The same template has to be
// rendered in the browser to show a person what a field will hold before they
// save it, and a full template engine cannot be mirrored in TypeScript honestly;
// a plain reference can.
//
// Everything that does not open with "{{." is left exactly as it was written.
// Values legitimately carry Go templates of their own (alert annotations
// "{{ $labels.instance }}", dashboard queries), and those must come out the
// other side untouched.

// TemplateData is everything a view document's templates can read.
//
// It describes the ORDER being written, never the session writing it. The same
// values are re-stamped by background merge retries, by the import reconciler
// and by support editing somebody else's order, so a field that answers "who
// made this" has to keep answering the same thing - otherwise it changes hands
// on every save, quietly, in Git.
type TemplateData struct {
	Team         string
	ServiceName  string
	Namespace    string
	Cluster      string
	Chart        string
	ChartVersion string
	User         TemplateUser
}

// TemplateUser is the order's author: the display name a person recognizes and
// the OIDC subject that identifies them for good. Both are stored on the order
// itself (created_by_name / created_by), which is what makes them stable across
// re-stamps.
type TemplateUser struct {
	Name    string
	Subject string
}

// TemplateRef is one reference a template may use, with the wording shown next
// to it where a view document is written.
type TemplateRef struct {
	Ref  string `json:"ref"`
	Desc string `json:"desc"`
}

// TemplateRefs is the whole catalogue, in the order it is offered. It is the one
// list: the resolver, the validator and (later) the editor's completions all
// read it, so a reference cannot exist in one of them and not the others.
func TemplateRefs() []TemplateRef {
	return []TemplateRef{
		{".Team", "Команда, от имени которой сделан заказ"},
		{".ServiceName", "Имя сервиса в заказе"},
		{".Namespace", "Неймспейс, в который уезжает заказ"},
		{".Cluster", "Кластер, в который уезжает заказ"},
		{".Chart", "Имя чарта"},
		{".ChartVersion", "Версия чарта"},
		{".User.Name", "ФИО автора заказа"},
		{".User.Subject", "Идентификатор автора заказа в OIDC"},
	}
}

// lookup resolves one reference. The bool separates "the portal has nothing
// here" (a name nobody answers to - a mistake in the document) from "the value
// is empty" (a legitimate answer: an order without a namespace of its own).
func (d TemplateData) lookup(ref string) (string, bool) {
	switch ref {
	case ".Team":
		return d.Team, true
	case ".ServiceName":
		return d.ServiceName, true
	case ".Namespace":
		return d.Namespace, true
	case ".Cluster":
		return d.Cluster, true
	case ".Chart":
		return d.Chart, true
	case ".ChartVersion":
		return d.ChartVersion, true
	case ".User.Name":
		return d.User.Name, true
	case ".User.Subject":
		return d.User.Subject, true
	}
	return "", false
}

const tmplOpen, tmplClose = "{{", "}}"

// refPattern is the whole grammar: a dotted path of identifiers.
var refPattern = regexp.MustCompile(`^\.[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$`)

// RenderTemplate expands every reference in s against d.
//
// An unknown reference is an error rather than an empty string: the result is
// committed to Git and deployed, so a value that quietly went missing would be
// found much later, by someone looking at a resource named after nothing.
func RenderTemplate(s string, d TemplateData) (string, error) {
	return walkTemplate(s, func(ref string) (string, error) {
		v, ok := d.lookup(ref)
		if !ok {
			return "", unknownRef(ref)
		}
		return v, nil
	})
}

// CheckTemplate reports what is wrong with s without needing an order to render
// it against. The version constructor asks this while the document is being
// written, which is the moment a typo costs nothing to fix; the same mistake
// found at order time costs a person their order.
func CheckTemplate(s string) error {
	_, err := walkTemplate(s, func(ref string) (string, error) {
		if _, ok := (TemplateData{}).lookup(ref); !ok {
			return "", unknownRef(ref)
		}
		return "", nil
	})
	return err
}

// walkTemplate is the single pass both rendering and checking go through, so
// what the constructor accepts and what an order expands can never drift apart.
func walkTemplate(s string, resolve func(ref string) (string, error)) (string, error) {
	var b strings.Builder
	for {
		i := strings.Index(s, tmplOpen)
		if i < 0 {
			b.WriteString(s)
			return b.String(), nil
		}
		rest := s[i+len(tmplOpen):]
		if !startsWithDot(rest) {
			// Somebody else's template ("{{ $labels.x }}", "{{- toYaml . }}").
			// Copy it out and keep looking past it.
			b.WriteString(s[:i+len(tmplOpen)])
			s = rest
			continue
		}
		inner, tail, closed := strings.Cut(rest, tmplClose)
		if !closed {
			return "", fmt.Errorf("не закрыта ссылка «%s%s»: не хватает «%s»",
				tmplOpen, strings.TrimSpace(rest), tmplClose)
		}
		expr := strings.TrimSpace(inner)
		if !refPattern.MatchString(expr) {
			return "", fmt.Errorf("«%s%s%s»: в шаблоне бывает только ссылка вида «%s.Team%s», без условий и функций",
				tmplOpen, expr, tmplClose, tmplOpen, tmplClose)
		}
		v, err := resolve(expr)
		if err != nil {
			return "", err
		}
		b.WriteString(s[:i])
		b.WriteString(v)
		s = tail
	}
}

// startsWithDot reports whether what follows "{{" is one of ours: a reference
// starts with a dot, optionally after whitespace.
func startsWithDot(s string) bool {
	return strings.HasPrefix(strings.TrimLeft(s, " \t"), ".")
}

func unknownRef(ref string) error {
	names := make([]string, 0, len(TemplateRefs()))
	for _, r := range TemplateRefs() {
		names = append(names, r.Ref)
	}
	return fmt.Errorf("нет такой ссылки «%s%s%s». Есть: %s",
		tmplOpen, ref, tmplClose, strings.Join(names, ", "))
}
