package publications_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"console/pkg/models"
)

func TestVariableCRUD(t *testing.T) {
	ctx := context.Background()
	svc, _ := setup(t)

	if err := svc.SetVariable(ctx, admin(), &models.Variable{
		Name: "OPS_DOMAIN", Value: "example.com", Description: "Домен стенда",
	}); err != nil {
		t.Fatalf("set: %v", err)
	}
	list, err := svc.ListVariables(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 1 || list[0].Value != "example.com" || list[0].UpdatedBy != "u-admin" {
		t.Fatalf("unexpected list: %#v", list)
	}

	// The name is the key: writing it again replaces the value.
	if err := svc.SetVariable(ctx, admin(), &models.Variable{Name: "OPS_DOMAIN", Value: "example.org"}); err != nil {
		t.Fatalf("update: %v", err)
	}
	list, _ = svc.ListVariables(ctx)
	if len(list) != 1 || list[0].Value != "example.org" {
		t.Fatalf("value not replaced: %#v", list)
	}

	if err := svc.DeleteVariable(ctx, admin(), "OPS_DOMAIN"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if list, _ = svc.ListVariables(ctx); len(list) != 0 {
		t.Fatalf("still there: %#v", list)
	}
}

func TestVariableNameRefused(t *testing.T) {
	ctx := context.Background()
	svc, _ := setup(t)
	for _, name := range []string{"ops", "1OPS", "OPS-DOMAIN", "OPS.DOMAIN", ""} {
		if err := svc.SetVariable(ctx, admin(), &models.Variable{Name: name, Value: "x"}); err == nil {
			t.Fatalf("name %q must be refused", name)
		}
	}
}

// Only an admin writes: one variable is read by every service referencing it,
// so a change here reaches other people's orders.
func TestVariableRBAC(t *testing.T) {
	ctx := context.Background()
	svc, _ := setup(t)
	if err := svc.SetVariable(ctx, member("core"), &models.Variable{Name: "OPS", Value: "x"}); err == nil {
		t.Fatal("a member must not write variables")
	}
	if err := svc.SetVariable(ctx, admin(), &models.Variable{Name: "OPS", Value: "x"}); err != nil {
		t.Fatalf("admin set: %v", err)
	}
	if err := svc.DeleteVariable(ctx, member("core"), "OPS"); err == nil {
		t.Fatal("a member must not delete variables")
	}
	// Reading is open: the constructor offers the names to whoever writes a document.
	if _, err := svc.ListVariables(ctx); err != nil {
		t.Fatalf("list: %v", err)
	}
}

// A variable a published document still names cannot be deleted: every order of
// that service would start refusing, and the person meeting the refusal is not
// the one who deleted it.
func TestVariableInUseIsNotDeleted(t *testing.T) {
	ctx := context.Background()
	svc, _ := setup(t)
	if err := svc.SetVariable(ctx, admin(), &models.Variable{Name: "OPS", Value: "x"}); err != nil {
		t.Fatalf("set: %v", err)
	}
	p := newPub(t, svc, member("core"), "postgres")
	view := json.RawMessage(`{"views":{"order":{}},"defaults":{"/labels/ops":"{{.Vars.OPS}}"}}`)
	publishVersion(t, svc, member("core"), p.ID, "1.0.0", view)

	used, err := svc.VariableUsage(ctx, "OPS")
	if err != nil {
		t.Fatalf("usage: %v", err)
	}
	if len(used) != 1 || !strings.Contains(used[0], "postgres") {
		t.Fatalf("usage = %v, want the publishing version", used)
	}
	err = svc.DeleteVariable(ctx, admin(), "OPS")
	if err == nil {
		t.Fatal("a variable in use must not be deleted")
	}
	if !errors.Is(err, models.ErrConflict) {
		t.Fatalf("want a conflict, got %T: %v", err, err)
	}
	if !strings.Contains(err.Error(), "postgres") {
		t.Fatalf("refusal must name what uses it: %v", err)
	}
}

// The constructor knows which variables exist, so a document naming one that
// does not is refused where it is written.
func TestVersionViewRefusesUnknownVariable(t *testing.T) {
	ctx := context.Background()
	svc, _ := setup(t)
	p := newPub(t, svc, member("core"), "postgres")

	view := json.RawMessage(`{"views":{"order":{}},"defaults":{"/labels/ops":"{{.Vars.NOPE}}"}}`)
	if _, err := svc.SaveVersionView(ctx, member("core"), p.ID, "1.0.0", view); err == nil {
		t.Fatal("a document naming an unknown variable must be refused")
	}

	if err := svc.SetVariable(ctx, admin(), &models.Variable{Name: "NOPE", Value: "x"}); err != nil {
		t.Fatalf("set: %v", err)
	}
	if _, err := svc.SaveVersionView(ctx, member("core"), p.ID, "1.0.0", view); err != nil {
		t.Fatalf("the same document must pass once the variable exists: %v", err)
	}
}

// The values a new order form opens with: rendered by the portal from the
// version's approved document, for the person opening the form and the team
// they are ordering for.
func TestOrderInitialValues(t *testing.T) {
	ctx := context.Background()
	svc, _ := setup(t)
	if err := svc.SetVariable(ctx, admin(), &models.Variable{Name: "OPS_DOMAIN", Value: "example.com"}); err != nil {
		t.Fatalf("set: %v", err)
	}
	p := newPub(t, svc, member("core"), "postgres")
	view := json.RawMessage(`{"views":{"order":{}},"initial":{` +
		`"/contacts/responsible":"{{.User.Name}}","/contacts/team":"{{.Team}}",` +
		`"/ingress/domain":"{{.Vars.OPS_DOMAIN}}"}}`)
	publishVersion(t, svc, member("core"), p.ID, "1.0.0", view)

	values, err := svc.OrderInitialValues(ctx, member("core"), "platform", "postgres", "1.0.0", "core")
	if err != nil {
		t.Fatalf("initial: %v", err)
	}
	contacts, _ := values["contacts"].(map[string]any)
	if contacts["responsible"] != "Member" || contacts["team"] != "core" {
		t.Fatalf("unexpected contacts: %#v", values)
	}
	ingress, _ := values["ingress"].(map[string]any)
	if ingress["domain"] != "example.com" {
		t.Fatalf("variable not rendered: %#v", values)
	}
}

// A version without the block seeds nothing, and says so with an empty object
// rather than an error the form would have to swallow.
func TestOrderInitialValuesWithoutBlock(t *testing.T) {
	ctx := context.Background()
	svc, _ := setup(t)
	p := newPub(t, svc, member("core"), "postgres")
	publishVersion(t, svc, member("core"), p.ID, "1.0.0", json.RawMessage(`{"views":{"order":{}}}`))

	values, err := svc.OrderInitialValues(ctx, member("core"), "platform", "postgres", "1.0.0", "core")
	if err != nil || len(values) != 0 {
		t.Fatalf("want an empty seed, got %#v (%v)", values, err)
	}
}
