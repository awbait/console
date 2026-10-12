package provisioning_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"console/internal/provisioning"
	"console/pkg/models"
)

// A copy is a draft of the same service on another stand: the values travel
// as they are, except what the document fills in from variables, which is
// rendered for the new stand. The original is untouched.
func TestCopyOrderToStand(t *testing.T) {
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
	view := []byte(`{"views":{"order":{"identity":"/auth/database"}},` +
		`"defaults":{"/labels/stamp":"{{.Vars.OPS_DOMAIN}}"},` +
		`"initial":{"/ingress/domain":"{{.ServiceName}}.{{.Vars.OPS_DOMAIN}}","/contacts/owner":"{{.User.Name}}"}}`)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", view)

	values := draft("app")
	values["ingress"] = map[string]any{"domain": "pg1.dev.example.com", "tls": true}
	values["contacts"] = map[string]any{"owner": "Somebody Else"}
	values["custom"] = "kept"
	src, err := s.prov.Create(ctx, member("core"), newOrder("pg1", onStand(dev.ID), func(in *provisioning.CreateInput) {
		in.Values = values
		in.DisplayName = "Payments DB"
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	copier := &models.User{Subject: "u2", Name: "Copier", Teams: []string{"core"}, Role: models.RoleMember}
	cp, err := s.prov.Copy(ctx, copier, src.ID, provisioning.CopyInput{StandID: prod.ID})
	if err != nil {
		t.Fatalf("copy: %v", err)
	}
	if cp.ID == src.ID || cp.Status != models.StatusDraft || cp.StandID != prod.ID || cp.Cluster != "prod-a" {
		t.Fatalf("copy: id=%s status=%s stand=%s cluster=%s", cp.ID, cp.Status, cp.StandID, cp.Cluster)
	}
	if cp.Team != "core" || cp.ServiceName != "pg1" || cp.DisplayName != "Payments DB" || cp.ChartVersion != "15.4.2" {
		t.Fatalf("copy identity: %+v", cp)
	}
	if cp.CreatedBy != "u2" {
		t.Fatalf("the person copying is the author, got %s", cp.CreatedBy)
	}
	for _, want := range []string{
		"domain: pg1.example.com", // initial, names a variable: rendered for prod
		"tls: true",               // next to it, untouched
		"owner: Somebody Else",    // initial without a variable: what the order holds stays
		"custom: kept",
		"stamp: example.com", // defaults are stamped for prod as on any save
	} {
		if !strings.Contains(cp.ValuesYAML, want) {
			t.Errorf("copy values lack %q:\n%s", want, cp.ValuesYAML)
		}
	}
	// The original is what it was.
	again, _ := s.prov.Get(ctx, member("core"), src.ID)
	if again.StandID != dev.ID || !strings.Contains(again.ValuesYAML, "domain: pg1.dev.example.com") {
		t.Fatalf("original changed: stand=%s\n%s", again.StandID, again.ValuesYAML)
	}
	evs, _ := s.st.ListEvents(ctx, cp.ID)
	var copied bool
	for _, e := range evs {
		if e.EventType == "copied" && e.Payload["source_id"] == src.ID && e.Payload["stand"] == "prod" {
			copied = true
		}
	}
	if !copied {
		t.Fatalf("the copy records where it came from: %+v", evs)
	}
}

// Same stand, same cluster, same name is a collision the person is told
// about; another name or another cluster on the same stand is fine.
func TestCopyNeedsAnotherNameOnTheSameCluster(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	dev := mustStand(ctx, t, s, "dev", "in-cluster")
	src, err := s.prov.Create(ctx, member("core"), newOrder("pg1", onStand(dev.ID)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	_, err = s.prov.Copy(ctx, member("core"), src.ID, provisioning.CopyInput{StandID: dev.ID})
	if !errors.Is(err, models.ErrConflict) {
		t.Fatalf("same name on the same cluster: want a conflict, got %v", err)
	}
	cp, err := s.prov.Copy(ctx, member("core"), src.ID, provisioning.CopyInput{StandID: dev.ID, ServiceName: "pg2"})
	if err != nil {
		t.Fatalf("copy under another name: %v", err)
	}
	if cp.ServiceName != "pg2" || cp.DisplayName != "pg2" {
		t.Fatalf("a display name that repeated the service name follows it: %s / %s", cp.ServiceName, cp.DisplayName)
	}
	cp, err = s.prov.Copy(ctx, member("core"), src.ID, provisioning.CopyInput{StandID: dev.ID, Cluster: "in-cluster-b"})
	if err != nil {
		t.Fatalf("copy to another cluster of the stand: %v", err)
	}
	if cp.Cluster != "in-cluster-b" || cp.ServiceName != "pg1" {
		t.Fatalf("copy on another cluster: %+v", cp)
	}
}

// Cluster names belong to each stand's Argo CD, so two stands may both call
// theirs in-cluster. A copy to such a stand is not a repeat of the original,
// neither by name nor by the resource identity in the namespace.
func TestCopyToAnotherStandWithTheSameClusterName(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	idp := mustStand(ctx, t, s, "idp", "in-cluster")
	edp := mustStand(ctx, t, s, "edp", "in-cluster")
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", []byte(`{"views":{"order":{"identity":"/auth/database"}}}`))
	src, err := s.prov.Create(ctx, member("core"), newOrder("pg1", onStand(idp.ID), func(in *provisioning.CreateInput) {
		in.Namespace = "db"
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if src.ResourceIdentity == "" {
		t.Fatalf("the order needs a resource identity for this test")
	}
	cp, err := s.prov.Copy(ctx, member("core"), src.ID, provisioning.CopyInput{StandID: edp.ID})
	if err != nil {
		t.Fatalf("copy to a stand with the same cluster name: %v", err)
	}
	if cp.StandID != edp.ID || cp.Cluster != "in-cluster" || cp.ServiceName != "pg1" || cp.Namespace != "db" {
		t.Fatalf("copy: %+v", cp)
	}
	// On one stand the same name is still a collision.
	if _, err := s.prov.Copy(ctx, member("core"), src.ID, provisioning.CopyInput{StandID: edp.ID}); !errors.Is(err, models.ErrConflict) {
		t.Fatalf("second copy to the same stand: want a conflict, got %v", err)
	}
}

// Copying is ordering: members of the team and admins, not readers of it, and
// not a deleted order.
func TestCopyAccess(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	mustStand(ctx, t, s, "dev", "in-cluster")
	src, err := s.prov.Create(ctx, member("core"), newOrder("pg1"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := s.prov.Copy(ctx, member("other"), src.ID, provisioning.CopyInput{}); err == nil {
		t.Fatal("another team must not copy")
	}
	if _, err := s.prov.Copy(ctx, support(), src.ID, provisioning.CopyInput{ServiceName: "pg2"}); !errors.Is(err, provisioning.ErrForbidden) {
		t.Fatalf("support reads but does not order: want ErrForbidden, got %v", err)
	}
	if _, err := s.prov.Copy(ctx, admin(), src.ID, provisioning.CopyInput{ServiceName: "pg2"}); err != nil {
		t.Fatalf("admin copies: %v", err)
	}
	if _, err := s.prov.Delete(ctx, member("core"), src.ID); err != nil {
		t.Fatalf("delete draft: %v", err)
	}
	_, err = s.prov.Copy(ctx, member("core"), src.ID, provisioning.CopyInput{ServiceName: "pg3"})
	var verr *provisioning.ValidationError
	if !errors.As(err, &verr) && !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("a deleted order is not copied: got %v", err)
	}
}
