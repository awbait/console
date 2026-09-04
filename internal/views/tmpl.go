package views

import (
	"fmt"
	"regexp"
	"sort"
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
	// Vars are the platform's own named values (models.Variable), by name. A
	// document references one as "{{.Vars.OPS}}". They belong to neither the
	// chart nor the order: an admin keeps them in the portal, so a domain or an
	// environment prefix that moves does not cost every service owner an edit
	// and a fresh approval of their document.
	Vars map[string]string
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
	// AtOrderForm marks a reference the order form already knows the answer to
	// while it is being filled in. Only those work in the "initial" block: the
	// namespace, the cluster and the service name are still being typed when the
	// form opens, so a value seeded from them would be seeded from nothing.
	AtOrderForm bool `json:"at_order_form"`
}

// TemplateRefs is the whole catalogue, in the order it is offered. It is the one
// list: the resolver, the validator and (later) the editor's completions all
// read it, so a reference cannot exist in one of them and not the others.
func TemplateRefs() []TemplateRef {
	return []TemplateRef{
		{".Team", "Команда, от имени которой сделан заказ", true},
		{".ServiceName", "Имя сервиса в заказе", false},
		{".Namespace", "Неймспейс, в который уезжает заказ", false},
		{".Cluster", "Кластер, в который уезжает заказ", false},
		{".Chart", "Имя чарта", true},
		{".ChartVersion", "Версия чарта", true},
		{".User.Name", "ФИО автора заказа", true},
		{".User.Subject", "Идентификатор автора заказа в OIDC", true},
	}
}

// varsPrefix opens a reference to a platform variable: everything after it is
// the variable's name.
const varsPrefix = ".Vars."

// varName returns the variable a reference names. Only a single segment counts:
// "{{.Vars.A.B}}" names no variable, and falls through to be reported as the
// unknown reference it is.
func varName(ref string) (string, bool) {
	name, ok := strings.CutPrefix(ref, varsPrefix)
	if !ok || name == "" || strings.Contains(name, ".") {
		return "", false
	}
	return name, true
}

// resolve answers one reference or says what is wrong with it. The two failures
// are kept apart on purpose: a name nobody answers to is a mistake in the
// document, while a variable that is simply not set is a mistake in the portal,
// and they are fixed by different people.
func (d TemplateData) resolve(ref string) (string, error) {
	if name, ok := varName(ref); ok {
		v, set := d.Vars[name]
		if !set {
			return "", varNotSet(name)
		}
		return v, nil
	}
	v, ok := d.lookup(ref)
	if !ok {
		return "", unknownRef(ref)
	}
	return v, nil
}

// lookup resolves one reference to the order. The bool separates "the portal has
// nothing here" (a name nobody answers to - a mistake in the document) from "the
// value is empty" (a legitimate answer: an order without a namespace of its own).
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

// refPattern is the whole grammar: a dotted path of identifiers. Underscores
// are in because a platform variable is named with them ("{{.Vars.OPS_DOMAIN}}").
var refPattern = regexp.MustCompile(`^\.[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$`)

// RenderTemplate expands every reference in s against d.
//
// An unknown reference is an error rather than an empty string: the result is
// committed to Git and deployed, so a value that quietly went missing would be
// found much later, by someone looking at a resource named after nothing.
func RenderTemplate(s string, d TemplateData) (string, error) {
	return walkTemplate(s, d.resolve)
}

// KnownVars is the platform variables a document may reference, by name, with
// the value each holds right now. A nil map means the caller has no list at
// hand: then only the shape of a "{{.Vars.X}}" reference is checked, not that
// the variable exists or that its value fits the field.
type KnownVars map[string]string

// CheckTemplate reports what is wrong with s without needing an order to render
// it against. The version constructor asks this while the document is being
// written, which is the moment a typo costs nothing to fix; the same mistake
// found at order time costs a person their order.
func CheckTemplate(s string, known KnownVars) error {
	_, err := walkTemplate(s, func(ref string) (string, error) {
		if name, ok := varName(ref); ok {
			if known == nil {
				return "", nil
			}
			if _, exists := known[name]; exists {
				return "", nil
			}
			return "", varNotSet(name)
		}
		if _, ok := (TemplateData{}).lookup(ref); !ok {
			return "", unknownRef(ref)
		}
		return "", nil
	})
	return err
}

// VariablesUsed returns the platform variables a view document references, by
// name, sorted and without repeats. Two callers ask: the order stamp, which
// reads the variables table only when a document actually needs it, and the
// admin page, which will not let a variable be deleted while a published
// document still names it.
func VariablesUsed(viewJSON []byte) []string {
	seen := map[string]bool{}
	collect := func(ref string) (string, error) {
		if name, ok := varName(ref); ok {
			seen[name] = true
		}
		return "", nil
	}
	for _, block := range []map[string]any{Defaults(viewJSON), Initial(viewJSON)} {
		for _, val := range block {
			s, ok := val.(string)
			if !ok {
				continue
			}
			// A document that does not parse still names what it names up to the
			// point it breaks: this is a scan, not a check.
			_, _ = walkTemplate(s, collect)
		}
	}
	out := make([]string, 0, len(seen))
	for name := range seen {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

// atOrderForm reports whether a reference is answerable while the order form is
// being filled in. Variables are: they are the platform's, not the order's.
func atOrderForm(ref string) bool {
	if _, ok := varName(ref); ok {
		return true
	}
	for _, r := range TemplateRefs() {
		if r.Ref == ref {
			return r.AtOrderForm
		}
	}
	return false
}

// CheckFormTimeTemplate is CheckTemplate for the "initial" block, which is
// rendered before an order exists. A reference the form cannot answer yet is
// named rather than left to render as an empty string in front of a person.
func CheckFormTimeTemplate(s string, known KnownVars) error {
	if err := CheckTemplate(s, known); err != nil {
		return err
	}
	_, err := walkTemplate(s, func(ref string) (string, error) {
		if !atOrderForm(ref) {
			return "", fmt.Errorf("ссылка «%s%s%s» в форме заказа ещё не известна: её значение выбирают в самой форме",
				tmplOpen, ref, tmplClose)
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
	return fmt.Errorf("нет такой ссылки «%s%s%s». Есть: %s, а также %s.Vars.ИМЯ%s для переменных платформы",
		tmplOpen, ref, tmplClose, strings.Join(names, ", "), tmplOpen, tmplClose)
}

// varNotSet is what a reference to a variable nobody has created says. It names
// where the variable comes from: the person reading it is either writing the
// document and picked a name that does not exist, or ordering a service whose
// document outlived the variable, and both need the same admin.
func varNotSet(name string) error {
	return fmt.Errorf("нет переменной «%s»: их заводит администратор платформы в разделе «Переменные»", name)
}
