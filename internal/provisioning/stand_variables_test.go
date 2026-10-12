package provisioning_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"console/internal/provisioning"
	"console/pkg/models"
)

// A variable is stamped with the value of the order's stand: the stand's own
// where it has one, the shared value elsewhere. Moving a draft re-stamps it
// with the new stand's values. An empty shared value on a stand without its
// own refuses the order and names both.
func TestOrderStampsVariableOfItsStand(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	dev := mustStand(ctx, t, s, "dev", "in-cluster")
	prod := mustStand(ctx, t, s, "prod", "prod-a")
	if err := s.st.UpsertVariable(ctx, &models.Variable{Name: "OPS_DOMAIN", Value: "dev.example.com"}); err != nil {
		t.Fatalf("seed variable: %v", err)
	}
	if err := s.st.SetVariableOverride(ctx, "OPS_DOMAIN", &models.VariableOverride{StandID: prod.ID, Value: "example.com"}); err != nil {
		t.Fatalf("seed override: %v", err)
	}
	view := []byte(`{"views":{"order":{"identity":"/auth/database"}},"defaults":{"/auth/host":"{{.ServiceName}}.{{.Vars.OPS_DOMAIN}}"}}`)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", view)

	onDev, err := s.prov.Create(ctx, member("core"), newOrder("alpha", onStand(dev.ID)))
	if err != nil {
		t.Fatalf("create on dev: %v", err)
	}
	if !strings.Contains(onDev.ValuesYAML, "host: alpha.dev.example.com") {
		t.Fatalf("dev order takes the shared value:\n%s", onDev.ValuesYAML)
	}
	onProd, err := s.prov.Create(ctx, member("core"), newOrder("beta", onStand(prod.ID)))
	if err != nil {
		t.Fatalf("create on prod: %v", err)
	}
	if !strings.Contains(onProd.ValuesYAML, "host: beta.example.com") {
		t.Fatalf("prod order takes the stand's own value:\n%s", onProd.ValuesYAML)
	}

	// A draft moved to prod is stamped again, with prod's value this time.
	moved, err := s.prov.Update(ctx, member("core"), onDev.ID, provisioning.UpdateInput{StandID: prod.ID, Values: draft("app")})
	if err != nil {
		t.Fatalf("move draft: %v", err)
	}
	if !strings.Contains(moved.ValuesYAML, "host: alpha.example.com") {
		t.Fatalf("moved draft keeps the old stand's value:\n%s", moved.ValuesYAML)
	}

	// The shared value goes: prod still has its own, dev has nothing to stamp.
	if err := s.st.UpsertVariable(ctx, &models.Variable{Name: "OPS_DOMAIN", Value: ""}); err != nil {
		t.Fatalf("clear shared: %v", err)
	}
	if _, err := s.prov.Create(ctx, member("core"), newOrder("gamma", onStand(prod.ID))); err != nil {
		t.Fatalf("prod still has a value of its own: %v", err)
	}
	_, err = s.prov.Create(ctx, member("core"), newOrder("delta", onStand(dev.ID)))
	var verr *provisioning.ValidationError
	if !errors.As(err, &verr) {
		t.Fatalf("an empty variable must refuse the order with a validation error, got %T: %v", err, err)
	}
	if !strings.Contains(verr.Message, "OPS_DOMAIN") || !strings.Contains(verr.Message, "«Переменные»") || !strings.Contains(verr.Message, "dev") {
		t.Fatalf("the refusal names the variable, the stand and where to fix it: %s", verr.Message)
	}
}

// Without stands there is only the shared value, and an empty one is refused
// without a stand to name.
func TestEmptyVariableWithoutStands(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	if err := s.st.UpsertVariable(ctx, &models.Variable{Name: "OPS_DOMAIN", Value: ""}); err != nil {
		t.Fatalf("seed variable: %v", err)
	}
	view := []byte(`{"views":{"order":{"identity":"/auth/database"}},"defaults":{"/auth/host":"{{.Vars.OPS_DOMAIN}}"}}`)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", view)

	_, err := s.prov.Create(ctx, member("core"), newOrder("alpha"))
	var verr *provisioning.ValidationError
	if !errors.As(err, &verr) {
		t.Fatalf("want a validation error, got %T: %v", err, err)
	}
	if !strings.Contains(verr.Message, "OPS_DOMAIN") || strings.Contains(verr.Message, "стенда") {
		t.Fatalf("names the variable and no stand: %s", verr.Message)
	}
}
