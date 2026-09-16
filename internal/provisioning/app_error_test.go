package provisioning_test

import (
	"context"
	"strings"
	"testing"

	"console/internal/argocd"
	"console/internal/provisioning"
	"console/pkg/models"
)

// An application ArgoCD cannot even render reports no health at all - the status
// stays Unknown - so the order used to sit wherever it was, usually DEPLOYING,
// until a person went looking in ArgoCD. The reason was there the whole time, in
// plain words, down to the field of the values that broke the chart.
func TestOrderWithAnUnbuildableApplicationIsDegradedWithTheReason(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")

	req, err := s.prov.Create(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "pg1", Values: validValues(),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	s.mergeLatestMR(ctx, t, req.ID)
	s.tick(ctx)
	if got := mustStatus(ctx, t, s.st, req.ID); got != models.StatusDeploying {
		t.Fatalf("want DEPLOYING, got %s", got)
	}

	// What ArgoCD holds for an order whose chart does not template: no health,
	// and a condition saying exactly what is wrong.
	const reason = `xroutes[4].name "ctlg" is already taken by another HTTPRoute on gateway "lk"`
	s.argo.Upsert(argocd.Application{
		Name:    req.ArgoCDAppName,
		Health:  argocd.HealthUnknown,
		Sync:    argocd.SyncUnknown,
		Error:   "ComparisonError: " + reason,
		Cluster: "in-cluster",
	})

	_ = s.prov.Reconcile(ctx)

	if got := mustStatus(ctx, t, s.st, req.ID); got != models.StatusDegraded {
		t.Fatalf("order left in %s with an application ArgoCD cannot build", got)
	}

	events, err := s.st.ListEvents(ctx, req.ID)
	if err != nil {
		t.Fatalf("events: %v", err)
	}
	var said int
	for _, e := range events {
		if e.EventType != "app_error" {
			continue
		}
		said++
		if got, _ := e.Payload["error"].(string); !strings.Contains(got, reason) {
			t.Errorf("the reason did not reach the order: %q", got)
		}
	}
	if said != 1 {
		t.Fatalf("the reason was recorded %d times, want once", said)
	}

	// The poller comes back every few seconds, and a reason already on the card
	// is not news.
	_ = s.prov.Reconcile(ctx)
	after, err := s.st.ListEvents(ctx, req.ID)
	if err != nil {
		t.Fatalf("events: %v", err)
	}
	if len(after) != len(events) {
		t.Errorf("the next tick announced it again (%d -> %d events)", len(events), len(after))
	}
}

// And once the values are fixed, the order goes back to following health like
// any other: an error reported is not a state the order is stuck in.
func TestAnOrderLeavesDegradedOnceTheApplicationBuilds(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")

	req, err := s.prov.Create(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "pg1", Values: validValues(),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	s.mergeLatestMR(ctx, t, req.ID)
	s.tick(ctx)
	s.argo.Upsert(argocd.Application{
		Name: req.ArgoCDAppName, Health: argocd.HealthUnknown,
		Sync: argocd.SyncUnknown, Error: "ComparisonError: broken", Cluster: "in-cluster",
	})
	_ = s.prov.Reconcile(ctx)

	s.argo.Upsert(argocd.Application{
		Name: req.ArgoCDAppName, Health: argocd.HealthHealthy,
		Sync: argocd.SyncSynced, Cluster: "in-cluster",
	})
	_ = s.prov.Reconcile(ctx)

	if got := mustStatus(ctx, t, s.st, req.ID); got != models.StatusHealthy {
		t.Fatalf("want HEALTHY once the application builds, got %s", got)
	}
}
