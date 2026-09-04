package models

import (
	"regexp"
	"time"
)

// Variable is a named value the platform team keeps in the portal, for a
// version document to reference as "{{.Vars.OPS}}".
//
// It exists because some of what a view document stamps into an order belongs
// to neither the chart nor the order: the domain a stand lives under, the team
// on duty, an environment prefix. Those are known by the platform team and
// change on their own schedule, so keeping them here spares every service owner
// an edit and a fresh approval of their own document when one of them moves.
//
// Not a secret store: the value ends up in values.yaml in Git, where everybody
// with access to the orders repository can read it.
type Variable struct {
	Name        string    `json:"name"`
	Value       string    `json:"value"`
	Description string    `json:"description"`
	UpdatedBy   string    `json:"updated_by,omitempty"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// variableNameRe mirrors the CHECK constraint on the variables table. Upper
// case and underscores, so a reference to a variable reads differently in a
// document than a reference to the order itself ("{{.Vars.OPS}}" vs "{{.Team}}").
var variableNameRe = regexp.MustCompile(`^[A-Z][A-Z0-9_]{0,63}$`)

// ValidVariableName reports whether name may be used for a platform variable.
func ValidVariableName(name string) bool { return variableNameRe.MatchString(name) }
