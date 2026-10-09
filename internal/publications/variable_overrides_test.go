package publications_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"console/internal/publications"
	"console/internal/store"
	"console/pkg/models"
)

func seedStands(ctx context.Context, t *testing.T, st *store.Memory) (dev, prod *models.Stand) {
	t.Helper()
	dev = &models.Stand{ID: "st-dev", Name: "dev", DefaultCluster: "in-cluster", Default: true}
	prod = &models.Stand{ID: "st-prod", Name: "prod", DefaultCluster: "prod-a"}
	for _, s := range []*models.Stand{dev, prod} {
		if err := st.CreateStand(ctx, s); err != nil {
			t.Fatalf("seed stand %s: %v", s.Name, err)
		}
	}
	return dev, prod
}

// A variable is one thing with a shared value and, where a stand needs its
// own, an override there. The list carries the overrides with the variable,
// an empty override takes the stand back to the shared value, and the
// override goes when the variable does.
func TestVariableOverrides(t *testing.T) {
	ctx := context.Background()
	svc, st := setup(t)
	_, prod := seedStands(ctx, t, st)
	if err := svc.SetVariable(ctx, admin(), &models.Variable{Name: "OPS_DOMAIN", Value: "dev.example.com"}); err != nil {
		t.Fatalf("set: %v", err)
	}

	if _, err := svc.SetVariableOverride(ctx, member("core"), "OPS_DOMAIN", prod.ID, "example.com"); !errors.Is(err, publications.ErrForbidden) {
		t.Fatalf("a member must not write overrides, got %v", err)
	}
	if _, err := svc.SetVariableOverride(ctx, admin(), "OPS_DOMAIN", "no-such-stand", "x"); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("unknown stand: want ErrNotFound, got %v", err)
	}
	if _, err := svc.SetVariableOverride(ctx, admin(), "NOPE", prod.ID, "x"); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("unknown variable: want ErrNotFound, got %v", err)
	}

	v, err := svc.SetVariableOverride(ctx, admin(), "OPS_DOMAIN", prod.ID, "  example.com ")
	if err != nil {
		t.Fatalf("override: %v", err)
	}
	if len(v.Overrides) != 1 || v.Overrides[0].StandID != prod.ID || v.Overrides[0].Value != "example.com" || v.Overrides[0].UpdatedBy != "u-admin" {
		t.Fatalf("override not on the variable: %#v", v.Overrides)
	}
	if v.ValueOn(prod.ID) != "example.com" || v.ValueOn("st-dev") != "dev.example.com" {
		t.Fatalf("ValueOn: prod=%q dev=%q", v.ValueOn(prod.ID), v.ValueOn("st-dev"))
	}
	list, _ := svc.ListVariables(ctx)
	if len(list) != 1 || len(list[0].Overrides) != 1 {
		t.Fatalf("list must carry the override: %#v", list)
	}

	// The shared value changes under the override without touching it.
	if err := svc.SetVariable(ctx, admin(), &models.Variable{Name: "OPS_DOMAIN", Value: "stage.example.com"}); err != nil {
		t.Fatalf("set again: %v", err)
	}
	list, _ = svc.ListVariables(ctx)
	if list[0].Value != "stage.example.com" || len(list[0].Overrides) != 1 {
		t.Fatalf("shared value change lost the override: %#v", list[0])
	}

	// Clearing is writing nothing: the stand is back on the shared value.
	v, err = svc.SetVariableOverride(ctx, admin(), "OPS_DOMAIN", prod.ID, "   ")
	if err != nil {
		t.Fatalf("clear: %v", err)
	}
	if len(v.Overrides) != 0 {
		t.Fatalf("an empty value must remove the override: %#v", v.Overrides)
	}
	// Clearing what is already clear is not an error: the page retries on blur.
	if _, err := svc.SetVariableOverride(ctx, admin(), "OPS_DOMAIN", prod.ID, ""); err != nil {
		t.Fatalf("clear twice: %v", err)
	}
	if err := svc.DeleteVariableOverride(ctx, admin(), "OPS_DOMAIN", prod.ID); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("explicit delete of nothing: want ErrNotFound, got %v", err)
	}

	if _, err := svc.SetVariableOverride(ctx, admin(), "OPS_DOMAIN", prod.ID, "example.com"); err != nil {
		t.Fatalf("override again: %v", err)
	}
	if err := svc.DeleteVariableOverride(ctx, member("core"), "OPS_DOMAIN", prod.ID); err == nil {
		t.Fatal("a member must not delete overrides")
	}
	if err := svc.DeleteVariableOverride(ctx, admin(), "OPS_DOMAIN", prod.ID); err != nil {
		t.Fatalf("delete override: %v", err)
	}
	if _, err := svc.SetVariableOverride(ctx, admin(), "OPS_DOMAIN", prod.ID, "example.com"); err != nil {
		t.Fatalf("override once more: %v", err)
	}
	if err := svc.DeleteVariable(ctx, admin(), "OPS_DOMAIN"); err != nil {
		t.Fatalf("delete variable: %v", err)
	}
	if err := svc.SetVariable(ctx, admin(), &models.Variable{Name: "OPS_DOMAIN", Value: "fresh"}); err != nil {
		t.Fatalf("recreate: %v", err)
	}
	list, _ = svc.ListVariables(ctx)
	if len(list[0].Overrides) != 0 {
		t.Fatalf("a recreated variable must not inherit the deleted one's overrides: %#v", list[0].Overrides)
	}
}

// The form opens with the values of the stand it is going to: the stand's own
// where it has one, the shared one elsewhere, and nothing at all, with the
// variable and the stand named, where neither is set.
func TestOrderInitialValuesPerStand(t *testing.T) {
	ctx := context.Background()
	svc, st := setup(t)
	dev, prod := seedStands(ctx, t, st)
	if err := svc.SetVariable(ctx, admin(), &models.Variable{Name: "OPS_DOMAIN", Value: "dev.example.com"}); err != nil {
		t.Fatalf("set: %v", err)
	}
	if _, err := svc.SetVariableOverride(ctx, admin(), "OPS_DOMAIN", prod.ID, "example.com"); err != nil {
		t.Fatalf("override: %v", err)
	}
	p := newPub(t, svc, member("core"), "postgres")
	view := json.RawMessage(`{"views":{"order":{}},"initial":{"/ingress/domain":"{{.Vars.OPS_DOMAIN}}"}}`)
	publishVersion(t, svc, member("core"), p.ID, "1.0.0", view)

	domain := func(standID string) string {
		t.Helper()
		values, err := svc.OrderInitialValues(ctx, member("core"), "platform", "postgres", "1.0.0", "core", standID)
		if err != nil {
			t.Fatalf("initial on %q: %v", standID, err)
		}
		ingress, _ := values["ingress"].(map[string]any)
		s, _ := ingress["domain"].(string)
		return s
	}
	if got := domain(prod.ID); got != "example.com" {
		t.Fatalf("prod must see its own value, got %q", got)
	}
	if got := domain(dev.ID); got != "dev.example.com" {
		t.Fatalf("dev falls back to the shared value, got %q", got)
	}
	// No stand named: the default stand, where the order would land.
	if got := domain(""); got != "dev.example.com" {
		t.Fatalf("no stand means the default stand, got %q", got)
	}

	// An empty shared value is a decision: every stand says its own, or the
	// order does not go. The refusal names both.
	if err := svc.SetVariable(ctx, admin(), &models.Variable{Name: "OPS_DOMAIN", Value: ""}); err != nil {
		t.Fatalf("clear shared: %v", err)
	}
	if got := domain(prod.ID); got != "example.com" {
		t.Fatalf("prod keeps its own value, got %q", got)
	}
	_, err := svc.OrderInitialValues(ctx, member("core"), "platform", "postgres", "1.0.0", "core", dev.ID)
	if err == nil {
		t.Fatal("an empty variable on a stand without an override must be refused")
	}
	if !strings.Contains(err.Error(), "OPS_DOMAIN") || !strings.Contains(err.Error(), "dev") {
		t.Fatalf("the refusal names the variable and the stand: %v", err)
	}
}
