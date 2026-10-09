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
	Name string `json:"name"`
	// Value is what the variable is worth on every stand that has no value of
	// its own. It may be empty on purpose: then an order on a stand without an
	// override is refused, naming the variable and the stand, instead of being
	// stamped with a value meant for somewhere else.
	Value       string    `json:"value"`
	Description string    `json:"description"`
	UpdatedBy   string    `json:"updated_by,omitempty"`
	UpdatedAt   time.Time `json:"updated_at"`
	// Overrides are the stands where the variable is worth something else, in
	// the order the stands are listed. A list response always carries the
	// field, empty when there are none.
	Overrides []VariableOverride `json:"overrides"`
}

// VariableOverride is a variable's own value on one stand.
type VariableOverride struct {
	StandID   string    `json:"stand_id"`
	Value     string    `json:"value"`
	UpdatedBy string    `json:"updated_by,omitempty"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ValueOn is what the variable is worth on the stand: its override there, or
// the shared value. An empty result is the case that stops an order; whether
// the variable exists at all is the caller's question, answered by the list.
func (v *Variable) ValueOn(standID string) string {
	for _, o := range v.Overrides {
		if o.StandID == standID {
			return o.Value
		}
	}
	return v.Value
}

// VariableValuesOn flattens the variables to name -> value as seen from the
// stand, the shape the template resolver and the document checker read.
func VariableValuesOn(list []*Variable, standID string) map[string]string {
	out := make(map[string]string, len(list))
	for _, v := range list {
		out[v.Name] = v.ValueOn(standID)
	}
	return out
}

// variableNameRe mirrors the CHECK constraint on the variables table. Upper
// case and underscores, so a reference to a variable reads differently in a
// document than a reference to the order itself ("{{.Vars.OPS}}" vs "{{.Team}}").
var variableNameRe = regexp.MustCompile(`^[A-Z][A-Z0-9_]{0,63}$`)

// ValidVariableName reports whether name may be used for a platform variable.
func ValidVariableName(name string) bool { return variableNameRe.MatchString(name) }
