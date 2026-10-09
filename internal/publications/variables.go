package publications

import (
	"context"
	"errors"
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
	// The shared values: the checker asks which variables exist and what shape
	// their values have, and a document is not written for one stand.
	vars, err := s.variableValues(ctx, "")
	if err != nil {
		s.logger().Warn("variables unreadable, view checked without them", "err", err)
		return nil
	}
	return []views.Option{views.WithVariables(vars)}
}

// variableValues reads the variables as name -> value, as seen from the stand:
// the stand's own value where it has one, the shared value elsewhere. An empty
// stand id reads the shared values.
func (s *Service) variableValues(ctx context.Context, standID string) (map[string]string, error) {
	list, err := s.store.ListVariables(ctx)
	if err != nil {
		return nil, err
	}
	return models.VariableValuesOn(list, standID), nil
}

// standFor is the stand an order would go to: the one named, or the default
// when none is. A portal without stands has neither, and that is not a failure
// here: the shared values are then the only ones there are.
func (s *Service) standFor(ctx context.Context, id string) (*models.Stand, error) {
	if id != "" {
		return s.store.GetStand(ctx, id)
	}
	st, err := s.store.DefaultStand(ctx)
	if errors.Is(err, models.ErrNotFound) {
		return nil, nil
	}
	return st, err
}

// SetVariableOverride gives a variable its own value on one stand. An empty
// value is not a value of its own: it removes the override, and the stand is
// back on the shared value. Admin only, for the reason SetVariable is.
func (s *Service) SetVariableOverride(ctx context.Context, u *models.User, name, standID, value string) (*models.Variable, error) {
	if !u.IsAdmin() {
		return nil, ErrForbidden
	}
	value = strings.TrimSpace(value)
	if len(value) > maxVariableValue {
		return nil, invalid("Значение переменной длиннее %d символов.", maxVariableValue)
	}
	if value == "" {
		if err := s.store.DeleteVariableOverride(ctx, name, standID); err != nil && !errors.Is(err, models.ErrNotFound) {
			return nil, err
		}
	} else {
		o := &models.VariableOverride{StandID: standID, Value: value, UpdatedBy: u.Subject}
		if err := s.store.SetVariableOverride(ctx, name, o); err != nil {
			return nil, err
		}
	}
	s.logger().Info("variable override set", "variable", name, "stand", standID, "cleared", value == "", "actor", u.Subject)
	return s.variable(ctx, name)
}

// DeleteVariableOverride puts the stand back on the variable's shared value.
func (s *Service) DeleteVariableOverride(ctx context.Context, u *models.User, name, standID string) error {
	if !u.IsAdmin() {
		return ErrForbidden
	}
	if err := s.store.DeleteVariableOverride(ctx, name, standID); err != nil {
		return err
	}
	s.logger().Info("variable override deleted", "variable", name, "stand", standID, "actor", u.Subject)
	return nil
}

// variable reads one variable with its overrides. The store lists them whole,
// which is fine for the handful there are.
func (s *Service) variable(ctx context.Context, name string) (*models.Variable, error) {
	list, err := s.store.ListVariables(ctx)
	if err != nil {
		return nil, err
	}
	for _, v := range list {
		if v.Name == name {
			return v, nil
		}
	}
	return nil, models.ErrNotFound
}

// OrderInitialValues renders the "initial" block of a version's approved view:
// the values a NEW order form opens with, filled in but editable.
//
// The rendering happens here rather than in the browser so there is one template
// engine and one catalogue of references. The context is only what an unfilled
// form knows: the team it is being made for, the stand it is going to, the
// chart, the person opening it, and the platform variables as that stand sees
// them. A document that asks for more is refused by the version constructor,
// so nothing here has to guess.
func (s *Service) OrderInitialValues(ctx context.Context, u *models.User, project, name, version, team, standID string) (map[string]any, error) {
	view, err := s.ActiveViewVersion(ctx, project, name, version)
	if err != nil {
		return nil, err
	}
	data := views.TemplateData{
		Team: team, Chart: name, ChartVersion: version,
		User: views.TemplateUser{Name: u.Name, Subject: u.Subject},
	}
	if len(views.VariablesUsed(view)) > 0 {
		stand, serr := s.standFor(ctx, standID)
		if serr != nil {
			return nil, serr
		}
		if stand != nil {
			standID, data.Stand = stand.ID, stand.Name
		}
		vars, lerr := s.variableValues(ctx, standID)
		if lerr != nil {
			return nil, lerr
		}
		data.Vars = vars
	}
	// The chart schema decides the type a seeded value takes: a port seeded from
	// a variable has to reach the form as a number, not as text in a number box.
	var schema []byte
	if s.schemas != nil {
		if b, _, serr := s.schemas.FormSchema(ctx, project, name, version); serr == nil {
			schema = b
		}
	}
	values, err := views.RenderInitial(view, data, schema)
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
