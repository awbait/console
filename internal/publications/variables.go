package publications

import (
	"context"
	"fmt"
	"strings"

	"console/internal/store"
	"console/internal/views"
	"console/pkg/models"
)

// Platform variables: named values an admin keeps in the portal for version
// documents to reference as "{{.Vars.OPS}}".
//
// They live in this domain because it owns view documents: what a document may
// reference is checked here, and a variable cannot be dropped while a document
// still names it. The values themselves are stamped into orders by provisioning.

// Bounds on a variable. Both are about the interface rather than the database:
// the value is shown in a table cell and stamped into an order, the description
// is a hint next to a completion in the constructor.
const (
	maxVariableValue = 4096
	maxVariableDesc  = 300
)

// ListVariables returns every variable, by name. Open to anybody signed in: the
// constructor offers them while a document is written, and the value reaches
// Git the moment it is used, so there is nothing here to keep from a reader.
func (s *Service) ListVariables(ctx context.Context) ([]*models.Variable, error) {
	return s.store.ListVariables(ctx)
}

// SetVariable creates a variable or replaces its value and description. Admin
// only: one variable is read by every service that references it, so changing
// one is a platform-wide act.
func (s *Service) SetVariable(ctx context.Context, u *models.User, v *models.Variable) error {
	if !u.IsAdmin() {
		return ErrForbidden
	}
	v.Name = strings.TrimSpace(v.Name)
	v.Value = strings.TrimSpace(v.Value)
	v.Description = strings.TrimSpace(v.Description)
	if !models.ValidVariableName(v.Name) {
		return invalid("Используйте заглавные латинские буквы, цифры и подчёркивание, начиная с буквы.")
	}
	if len(v.Value) > maxVariableValue {
		return invalid("Значение переменной длиннее %d символов.", maxVariableValue)
	}
	if len(v.Description) > maxVariableDesc {
		return invalid("Описание переменной длиннее %d символов.", maxVariableDesc)
	}
	v.UpdatedBy = u.Subject
	if err := s.store.UpsertVariable(ctx, v); err != nil {
		return err
	}
	s.logger().Info("variable set", "variable", v.Name, "actor", u.Subject)
	return nil
}

// DeleteVariable removes a variable nobody references. A document that names a
// variable that is gone refuses every order made from it, and the person who
// meets that refusal is not the one deleting: the refusal belongs here, where
// the services still using it can be named.
func (s *Service) DeleteVariable(ctx context.Context, u *models.User, name string) error {
	if !u.IsAdmin() {
		return ErrForbidden
	}
	used, err := s.VariableUsage(ctx, name)
	if err != nil {
		return err
	}
	if len(used) > 0 {
		return conflict("Переменную «%s» использует %s. Уберите ссылку из документа версии, потом удаляйте.", name, listOf(used, 3))
	}
	if err := s.store.DeleteVariable(ctx, name); err != nil {
		return err
	}
	s.logger().Info("variable deleted", "variable", name, "actor", u.Subject)
	return nil
}

// VariableUsage names the versions whose document references the variable, as
// "project/chart 1.2.3". Both the draft and the approved document count: the
// draft is somebody's work in progress and would break on approval, the
// approved one is what orders are built from right now.
func (s *Service) VariableUsage(ctx context.Context, name string) ([]string, error) {
	pubs, err := s.store.ListPublications(ctx, store.PublicationFilter{})
	if err != nil {
		return nil, err
	}
	var used []string
	for _, p := range pubs {
		versions, err := s.store.ListVersions(ctx, p.ID)
		if err != nil {
			return nil, err
		}
		for _, v := range versions {
			if referencesVariable(v.ViewJSON, name) || referencesVariable(v.ApprovedViewJSON, name) {
				used = append(used, fmt.Sprintf("%s/%s %s", p.ChartProject, p.ChartName, v.ChartVersion))
			}
		}
	}
	return used, nil
}

func referencesVariable(view []byte, name string) bool {
	for _, used := range views.VariablesUsed(view) {
		if used == name {
			return true
		}
	}
	return false
}

// checkAgainstVariables is how a document gets its "{{.Vars.X}}" references
// checked: with the names that exist right now. Best effort - a store that
// cannot answer leaves those references unchecked rather than failing the save,
// and the order stamp still refuses to write a value it cannot resolve. It
// returns options rather than names so "could not read" stays distinct from
// "there are none", which would flag every reference.
func (s *Service) checkAgainstVariables(ctx context.Context) []views.Option {
	list, err := s.store.ListVariables(ctx)
	if err != nil {
		s.logger().Warn("variables unreadable, view checked without them", "err", err)
		return nil
	}
	names := make([]string, 0, len(list))
	for _, v := range list {
		names = append(names, v.Name)
	}
	return []views.Option{views.WithVariables(names)}
}

// OrderInitialValues renders the "initial" block of a version's approved view:
// the values a NEW order form opens with, filled in but editable.
//
// The rendering happens here rather than in the browser so there is one template
// engine and one catalogue of references. The context is only what an unfilled
// form knows: the team it is being made for, the chart, the person opening it,
// and the platform variables. A document that asks for more is refused by the
// version constructor, so nothing here has to guess.
func (s *Service) OrderInitialValues(ctx context.Context, u *models.User, project, name, version, team string) (map[string]any, error) {
	view, err := s.ActiveViewVersion(ctx, project, name, version)
	if err != nil {
		return nil, err
	}
	data := views.TemplateData{
		Team: team, Chart: name, ChartVersion: version,
		User: views.TemplateUser{Name: u.Name, Subject: u.Subject},
	}
	if len(views.VariablesUsed(view)) > 0 {
		list, lerr := s.store.ListVariables(ctx)
		if lerr != nil {
			return nil, lerr
		}
		data.Vars = make(map[string]string, len(list))
		for _, v := range list {
			data.Vars[v.Name] = v.Value
		}
	}
	values, err := views.RenderInitial(view, data)
	if err != nil {
		return nil, invalid("%s", err.Error())
	}
	return values, nil
}

// listOf writes at most n names as one phrase, saying how many are left.
func listOf(items []string, n int) string {
	if len(items) <= n {
		return strings.Join(items, ", ")
	}
	return fmt.Sprintf("%s и ещё %d", strings.Join(items[:n], ", "), len(items)-n)
}
