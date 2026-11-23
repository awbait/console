package provisioning_test

import (
	"context"
	"testing"

	"console/internal/argocd"
	"console/internal/provisioning"
	"console/pkg/models"
)

func TestReconcileArgoMissingTransitionAndRecovery(t *testing.T) {
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
	s.tick(ctx)

	got, err := s.prov.Get(ctx, u, req.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Status != models.StatusHealthy {
		t.Fatalf("after deploy want HEALTHY, got %s", got.Status)
	}

	app, err := s.argo.GetApplication(ctx, got.ArgoCDAppName)
	if err != nil {
		t.Fatalf("get argo app: %v", err)
	}

	// ArgoCD reports Missing: HEALTHY -> ARGO_MISSING.
	missing := *app
	missing.Health = argocd.HealthMissing
	s.argo.Upsert(missing)
	if err := s.prov.Reconcile(ctx); err != nil {
		t.Fatalf("reconcile missing: %v", err)
	}
	got, err = s.prov.Get(ctx, u, req.ID)
	if err != nil {
		t.Fatalf("get missing: %v", err)
	}
	if got.Status != models.StatusArgoMissing {
		t.Fatalf("want ARGO_MISSING, got %s", got.Status)
	}

	// ArgoCD reports Healthy again: ARGO_MISSING -> HEALTHY directly.
	recovered := *app
	recovered.Health = argocd.HealthHealthy
	s.argo.Upsert(recovered)
	if err := s.prov.Reconcile(ctx); err != nil {
		t.Fatalf("reconcile recovery: %v", err)
	}
	got, err = s.prov.Get(ctx, u, req.ID)
	if err != nil {
		t.Fatalf("get recovered: %v", err)
	}
	if got.Status != models.StatusHealthy {
		t.Fatalf("want HEALTHY after recovery, got %s", got.Status)
	}
}
