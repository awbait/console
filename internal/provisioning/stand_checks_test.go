package provisioning_test

import (
	"context"
	"testing"
	"time"

	"console/internal/argocd"
	"console/internal/provisioning"
	"console/pkg/models"
)

// standArgoFake is the slice of Argo CD the stand checks read: which
// clusters exist and which applications. It counts the looks, so a test can
// tell a round that ran from one the interval skipped.
type standArgoFake struct {
	clusters []string
	apps     map[string]bool
	looks    int
}

func (f *standArgoFake) ListClusters(context.Context) ([]argocd.Cluster, error) {
	f.looks++
	out := make([]argocd.Cluster, 0, len(f.clusters))
	for _, c := range f.clusters {
		out = append(out, argocd.Cluster{Name: c, Server: "https://" + c})
	}
	return out, nil
}

func (f *standArgoFake) GetApplication(_ context.Context, name string) (*argocd.Application, error) {
	if f.apps[name] {
		return &argocd.Application{Name: name}, nil
	}
	return nil, models.ErrNotFound
}

// The project the stand's applications go to exists, and the token may do
// everything with it: these tests are about the clusters and applications.
func (f *standArgoFake) ProjectExists(context.Context, string) (bool, error) { return true, nil }
func (f *standArgoFake) CanI(context.Context, string, string, string) (bool, error) {
	return true, nil
}

// The checks of a stand are stored when run, and the application check sets
// whether Argo CD is wired to the stand: a live order Argo CD does not know
// means not wired, an order it knows means wired, no order leaves it alone.
func TestCheckStandStoresAndFlagsArgo(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	argo := &standArgoFake{clusters: []string{"in-cluster"}, apps: map[string]bool{}}
	s.prov.StandArgo = argo
	st := standInMode("stage", models.ModeDeploy)
	st.GitPath = "managed-services"
	if err := s.prov.CreateStand(ctx, admin(), st); err != nil {
		t.Fatalf("create stand: %v", err)
	}
	// Nothing placed yet: Argo CD has nothing to look for, so the flag stays
	// at its hopeful default.
	results, err := s.prov.CheckStand(ctx, st)
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if len(results) != 4 || !st.ArgoConnected || st.CheckedAt == nil {
		t.Fatalf("first check: %d results, connected=%v, checked=%v", len(results), st.ArgoConnected, st.CheckedAt)
	}
	stored, err := s.st.ListStandChecks(ctx, st.ID)
	if err != nil || len(stored) != 4 {
		t.Fatalf("stored checks: %d %v", len(stored), err)
	}

	r, err := s.prov.Create(ctx, member("core"), newOrder("pg1", placed("pg1", st.ID)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := s.prov.CheckStand(ctx, st); err != nil {
		t.Fatalf("check: %v", err)
	}
	if st.ArgoConnected {
		t.Fatalf("a live order Argo CD does not know: the stand is not wired")
	}
	got, _ := s.prov.GetStand(ctx, st.ID)
	if got.ArgoConnected || got.CheckedAt == nil {
		t.Fatalf("the flag is stored: %+v", got)
	}
	argo.apps[r.ArgoCDAppName] = true
	if _, err := s.prov.CheckStand(ctx, st); err != nil {
		t.Fatalf("check: %v", err)
	}
	if !st.ArgoConnected {
		t.Fatalf("Argo CD sees the application: the stand is wired")
	}
}

// The background round runs every stand once per interval and not between.
func TestRunStandChecksKeepsItsInterval(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	argo := &standArgoFake{clusters: []string{"in-cluster"}}
	s.prov.StandArgo = argo
	s.prov.StandChecksInterval = time.Hour
	for _, name := range []string{"a", "b"} {
		st := standInMode(name, models.ModeDeploy)
		if err := s.prov.CreateStand(ctx, admin(), st); err != nil {
			t.Fatalf("create stand: %v", err)
		}
	}
	if err := s.prov.RunStandChecks(ctx); err != nil {
		t.Fatalf("round: %v", err)
	}
	if argo.looks != 2 {
		t.Fatalf("one look per stand: %d", argo.looks)
	}
	if err := s.prov.RunStandChecks(ctx); err != nil {
		t.Fatalf("round: %v", err)
	}
	if argo.looks != 2 {
		t.Fatalf("a second round inside the interval does nothing: %d looks", argo.looks)
	}
	s.prov.StandChecksInterval = 0
	all, _ := s.st.ListAllStandChecks(ctx)
	if len(all) != 8 {
		t.Fatalf("stored checks of two stands: %d", len(all))
	}
}

// The status page's summary: the worst stored verdict per stand, and a stand
// nobody has looked at yet is unknown rather than fine.
func TestStandChecksSummary(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	s.prov.StandArgo = &standArgoFake{clusters: []string{"in-cluster"}}
	checked := standInMode("checked", models.ModeDeploy)
	fresh := standInMode("fresh", models.ModeDeploy)
	for _, st := range []*models.Stand{checked, fresh} {
		if err := s.prov.CreateStand(ctx, admin(), st); err != nil {
			t.Fatalf("create stand: %v", err)
		}
	}
	if _, err := s.prov.CheckStand(ctx, checked); err != nil {
		t.Fatalf("check: %v", err)
	}
	sum, err := s.prov.StandChecksSummary(ctx)
	if err != nil {
		t.Fatalf("summary: %v", err)
	}
	by := map[string]provisioning.StandChecksSummary{}
	for _, x := range sum {
		by[x.Stand.Name] = x
	}
	// No GitLab to read through: that check is unknown, which outranks the
	// clusters' ok.
	if by["checked"].Worst != "unknown" || len(by["checked"].Results) != 4 {
		t.Fatalf("checked stand: %+v", by["checked"])
	}
	if by["fresh"].Worst != "unknown" || len(by["fresh"].Results) != 0 {
		t.Fatalf("never checked stand: %+v", by["fresh"])
	}
}
