package views

import (
	"strings"
	"testing"
)

// A variable that exists but is empty for the stand is refused, not stamped:
// the refusal names the variable and, when there is one, the stand. A
// variable nobody created is a different complaint, about the document.
func TestRenderTemplateEmptyVariable(t *testing.T) {
	d := sampleData()
	d.Vars = map[string]string{"OPS_DOMAIN": "", "OPS_TEAM": "sre"}

	if got, err := RenderTemplate("{{.Vars.OPS_TEAM}}", d); err != nil || got != "sre" {
		t.Fatalf("set variable: %q, %v", got, err)
	}

	_, err := RenderTemplate("{{.Vars.OPS_DOMAIN}}", d)
	if err == nil || !strings.Contains(err.Error(), "OPS_DOMAIN") || strings.Contains(err.Error(), "стенда") {
		t.Fatalf("empty without a stand names only the variable: %v", err)
	}

	d.Stand = "prod"
	_, err = RenderTemplate("{{.Vars.OPS_DOMAIN}}", d)
	if err == nil || !strings.Contains(err.Error(), "OPS_DOMAIN") || !strings.Contains(err.Error(), "prod") {
		t.Fatalf("empty on a stand names both: %v", err)
	}

	_, err = RenderTemplate("{{.Vars.GONE}}", d)
	if err == nil || !strings.Contains(err.Error(), "нет переменной") {
		t.Fatalf("a missing variable is a different complaint: %v", err)
	}

	// The constructor's check only asks whether the variable exists: an empty
	// shared value is a decision for the stands, not a mistake in the document.
	if err := CheckTemplate("{{.Vars.OPS_DOMAIN}}", KnownVars(d.Vars)); err != nil {
		t.Fatalf("an empty variable passes the document check: %v", err)
	}
}
