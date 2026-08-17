package provisioning_test

import (
	"context"
	"strings"
	"testing"

	"console/internal/provisioning"
	"console/pkg/models"
)

// A chart version deleted from the registry cannot be deployed, whatever the
// catalog allowlist still says about it. The allowlist is a person's decision
// and stays where it is; what the registry no longer has simply cannot be
// ordered, edited onto an order, or moved to.

const orderView = `{"views":{"order":{"identity":"/auth/database"}}}`

func TestOrderOfMissingVersionIsRefused(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", []byte(orderView))
	s.hb.RemoveVersion("platform", "postgres", "15.4.2")

	_, err := s.prov.Create(ctx, member("core"), provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "pg1", Values: validValues(),
	})
	if err == nil {
		t.Fatal("want the order refused")
	}
	if !strings.Contains(err.Error(), "больше нет в реестре") {
		t.Fatalf("error = %v, want it to say the version is gone from the registry", err)
	}
}

// Editing an order whose version has since been deleted is refused rather than
// written through: the schema went with the chart, so nothing could check the
// values, and the result could not be deployed anyway.
func TestEditingAnOrderOnAMissingVersionIsRefused(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", []byte(orderView))
	r := liveOrder(ctx, t, s)

	s.hb.RemoveVersion("platform", "postgres", "15.4.2")

	_, err := s.prov.Update(ctx, member("core"), r.ID, provisioning.UpdateInput{
		Values: map[string]any{"auth": map[string]any{"database": "renamed"}},
	})
	if err == nil {
		t.Fatal("want the edit refused")
	}
	if !strings.Contains(err.Error(), "больше нет в реестре") {
		t.Fatalf("error = %v, want it to say the version is gone from the registry", err)
	}
	after, err := s.st.GetRequest(ctx, r.ID)
	if err != nil {
		t.Fatalf("get order: %v", err)
	}
	if after.Status != r.Status {
		t.Fatalf("status changed to %s: a refused edit must leave the order alone", after.Status)
	}
}

func TestMovingAnOrderToAMissingVersionIsRefused(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", []byte(orderView))
	r := liveOrder(ctx, t, s)
	seedVersion(t, s, "postgres", "15.4.3", []byte(orderView))
	s.hb.RemoveVersion("platform", "postgres", "15.4.3")

	_, err := s.prov.Update(ctx, member("core"), r.ID, provisioning.UpdateInput{
		Version: "15.4.3", Values: validValues(),
	})
	if err == nil {
		t.Fatal("want the move refused")
	}
}

// The way out for an order stuck on a deleted version: move it to one the
// registry still has. That has to keep working, or the order would be trapped.
func TestMovingAnOrderOffAMissingVersionIsAllowed(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	// 15.4.1 and 15.4.2 both exist in the registry; the order runs on 15.4.2,
	// which is then deleted.
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", []byte(orderView))
	seedVersion(t, s, "postgres", "15.4.1", []byte(orderView))
	r := liveOrder(ctx, t, s)
	s.hb.RemoveVersion("platform", "postgres", "15.4.2")

	got, err := s.prov.Update(ctx, member("core"), r.ID, provisioning.UpdateInput{
		Version: "15.4.1", Values: validValues(),
	})
	if err != nil {
		t.Fatalf("move to an available version refused: %v", err)
	}
	if got.ChartVersion != "15.4.1" {
		t.Fatalf("version = %s, want the order moved to 15.4.1", got.ChartVersion)
	}
	if got.Status != models.StatusMRCreated {
		t.Fatalf("status = %s, want MR_CREATED", got.Status)
	}
}
