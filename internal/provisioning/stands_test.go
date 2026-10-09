package provisioning_test

import (
	"context"
	"errors"
	"testing"

	"console/internal/provisioning"
	"console/pkg/models"
)

func admin() *models.User {
	return &models.User{Subject: "adm", Name: "Ada Admin", Role: models.RoleAdmin}
}

func mustStand(ctx context.Context, t *testing.T, s *stack, name, cluster string) *models.Stand {
	t.Helper()
	st := &models.Stand{Name: name, DefaultCluster: cluster}
	if err := s.prov.CreateStand(ctx, admin(), st); err != nil {
		t.Fatalf("create stand %s: %v", name, err)
	}
	return st
}

func newOrder(serviceName string, opts ...func(*provisioning.CreateInput)) provisioning.CreateInput {
	in := provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: serviceName, Values: draft("app"), Draft: true,
	}
	for _, o := range opts {
		o(&in)
	}
	return in
}

func onStand(id string) func(*provisioning.CreateInput) {
	return func(in *provisioning.CreateInput) { in.StandID = id }
}
func inCluster(c string) func(*provisioning.CreateInput) {
	return func(in *provisioning.CreateInput) { in.Cluster = c }
}

// The default cluster of a stand becomes the cluster of orders, and a cluster
// lands in Git commit paths and in the rendered application.yaml destination,
// so both are checked the same way: a Kubernetes name, nothing that can carry
// "../" or a newline.
func TestStandDefaultClusterIsChecked(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)

	for _, bad := range []string{"../evil", "a/b", "Up", "with space", ""} {
		err := s.prov.CreateStand(ctx, admin(), &models.Stand{Name: "x", DefaultCluster: bad})
		var ve *provisioning.ValidationError
		if !errors.As(err, &ve) {
			t.Errorf("cluster %q: want ValidationError, got %v", bad, err)
		}
	}
	for _, bad := range []string{"", "   "} {
		err := s.prov.CreateStand(ctx, admin(), &models.Stand{Name: bad, DefaultCluster: "in-cluster"})
		var ve *provisioning.ValidationError
		if !errors.As(err, &ve) {
			t.Errorf("name %q: want ValidationError, got %v", bad, err)
		}
	}

	st := mustStand(ctx, t, s, "dev", "in-cluster")
	if !st.Default {
		t.Fatal("the first stand must become the default")
	}
	if st.ID == "" {
		t.Fatal("a created stand carries its id")
	}
	if err := s.prov.CreateStand(ctx, admin(), &models.Stand{Name: "dev", DefaultCluster: "other"}); !errors.Is(err, models.ErrConflict) {
		t.Fatalf("duplicate name: want ErrConflict, got %v", err)
	}
	second := mustStand(ctx, t, s, "edge", "edge")
	if second.Default {
		t.Fatal("only the first stand is made the default on its own")
	}
}

// Stands are a platform-wide thing: members read them, only admins write them.
func TestStandsAreAdminWritten(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")

	if err := s.prov.CreateStand(ctx, u, &models.Stand{Name: "dev", DefaultCluster: "in-cluster"}); !errors.Is(err, provisioning.ErrForbidden) {
		t.Fatalf("member create: want ErrForbidden, got %v", err)
	}
	st := mustStand(ctx, t, s, "dev", "in-cluster")
	if err := s.prov.UpdateStand(ctx, u, &models.Stand{ID: st.ID, Name: "dev2", DefaultCluster: "in-cluster"}); !errors.Is(err, provisioning.ErrForbidden) {
		t.Fatalf("member update: want ErrForbidden, got %v", err)
	}
	if err := s.prov.SetDefaultStand(ctx, u, st.ID); !errors.Is(err, provisioning.ErrForbidden) {
		t.Fatalf("member default: want ErrForbidden, got %v", err)
	}
	list, err := s.prov.ListStands(ctx)
	if err != nil || len(list) != 1 {
		t.Fatalf("member list: %v %d", err, len(list))
	}
}

// An order is placed on the stand it names, or the default when it names none,
// and starts from that stand's default cluster unless it names a cluster of its
// own. The cluster it ends up with is checked either way.
func TestOrderStandAndCluster(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")
	dev := mustStand(ctx, t, s, "dev", "in-cluster")
	edge := mustStand(ctx, t, s, "edge", "edge-cluster")

	onEdge, err := s.prov.Create(ctx, u, newOrder("svc", onStand(edge.ID)))
	if err != nil {
		t.Fatalf("create on edge: %v", err)
	}
	if onEdge.StandID != edge.ID || onEdge.Cluster != "edge-cluster" {
		t.Fatalf("order on edge: stand=%q cluster=%q", onEdge.StandID, onEdge.Cluster)
	}
	// The cluster is what the Git folder is built on.
	if onEdge.InstancePath != "edge-cluster/svc/svc" {
		t.Fatalf("instance path follows the cluster, got %q", onEdge.InstancePath)
	}

	onDefault, err := s.prov.Create(ctx, u, newOrder("svc2"))
	if err != nil {
		t.Fatalf("create on default: %v", err)
	}
	if onDefault.StandID != dev.ID || onDefault.Cluster != "in-cluster" {
		t.Fatalf("order on default: stand=%q cluster=%q", onDefault.StandID, onDefault.Cluster)
	}

	// A stand spans several clusters: the order may name another one.
	other, err := s.prov.Create(ctx, u, newOrder("svc3", onStand(edge.ID), inCluster("edge-b")))
	if err != nil {
		t.Fatalf("create in another cluster: %v", err)
	}
	if other.StandID != edge.ID || other.Cluster != "edge-b" {
		t.Fatalf("order in another cluster: stand=%q cluster=%q", other.StandID, other.Cluster)
	}

	for _, bad := range []string{"../evil", "a/b", "Up", "with space"} {
		_, err := s.prov.Create(ctx, u, newOrder("svc4", inCluster(bad)))
		var ve *provisioning.ValidationError
		if !errors.As(err, &ve) {
			t.Errorf("cluster %q: want ValidationError, got %v", bad, err)
		}
	}
	_, err = s.prov.Create(ctx, u, newOrder("svc5", onStand("nope")))
	var ve *provisioning.ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("unknown stand: want ValidationError, got %v", err)
	}
}

// A draft may still move between stands and clusters; an order that has left
// the draft keeps both, whatever the update names.
func TestDraftMovesBetweenStandsUntilSubmitted(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")
	dev := mustStand(ctx, t, s, "dev", "in-cluster")
	edge := mustStand(ctx, t, s, "edge", "edge-cluster")

	r, err := s.prov.Create(ctx, u, newOrder("svc"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	// Moving to a stand without naming a cluster starts from that stand's
	// default cluster.
	moved, err := s.prov.Update(ctx, u, r.ID, provisioning.UpdateInput{StandID: edge.ID, Values: validValues()})
	if err != nil {
		t.Fatalf("move draft: %v", err)
	}
	if moved.StandID != edge.ID || moved.Cluster != "edge-cluster" || moved.InstancePath != "edge-cluster/svc/svc" {
		t.Fatalf("draft did not move: stand=%q cluster=%q path=%q", moved.StandID, moved.Cluster, moved.InstancePath)
	}
	// A cluster of its own on the same stand.
	moved, err = s.prov.Update(ctx, u, r.ID, provisioning.UpdateInput{Cluster: "edge-b", Values: validValues()})
	if err != nil {
		t.Fatalf("change cluster: %v", err)
	}
	if moved.StandID != edge.ID || moved.Cluster != "edge-b" {
		t.Fatalf("cluster change: stand=%q cluster=%q", moved.StandID, moved.Cluster)
	}
	if _, err := s.prov.Update(ctx, u, r.ID, provisioning.UpdateInput{Cluster: "Bad", Values: validValues()}); err == nil {
		t.Fatal("a bad cluster on a draft must be refused")
	}

	live := seedOrder(ctx, t, s)
	if live.StandID != dev.ID {
		t.Fatalf("seeded order lands on the default stand, got %q", live.StandID)
	}
	after, err := s.prov.Update(ctx, u, live.ID, provisioning.UpdateInput{
		StandID: edge.ID, Cluster: "edge-b", Values: map[string]any{"auth": map[string]any{"database": "edited"}},
	})
	if err != nil {
		t.Fatalf("update live: %v", err)
	}
	if after.StandID != dev.ID || after.Cluster != "in-cluster" {
		t.Fatalf("a live order must keep its stand and cluster, got stand=%q cluster=%q", after.StandID, after.Cluster)
	}
}

// A store nothing was seeded into has no stand; an order still gets the
// configured cluster, as every order did before stands existed.
func TestNoStandsFallBackToConfiguredCluster(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	r, err := s.prov.Create(ctx, member("core"), newOrder("svc"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if r.StandID != "" || r.Cluster != "in-cluster" {
		t.Fatalf("got stand=%q cluster=%q", r.StandID, r.Cluster)
	}
}

// Changing a stand's default cluster applies to the orders placed afterwards;
// the ones already on it keep the cluster their files and application were
// made with. The default flag moves as one operation.
func TestStandChangesDoNotMoveOrders(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")
	dev := mustStand(ctx, t, s, "dev", "in-cluster")

	before, err := s.prov.Create(ctx, u, newOrder("svc"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := s.prov.UpdateStand(ctx, admin(), &models.Stand{ID: dev.ID, Name: "dev", DefaultCluster: "moved"}); err != nil {
		t.Fatalf("update stand: %v", err)
	}
	got, err := s.prov.Get(ctx, u, before.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Cluster != "in-cluster" {
		t.Fatalf("existing order moved to %q", got.Cluster)
	}
	after, err := s.prov.Create(ctx, u, newOrder("svc2"))
	if err != nil {
		t.Fatalf("create after: %v", err)
	}
	if after.Cluster != "moved" {
		t.Fatalf("new order should take the new default cluster, got %q", after.Cluster)
	}

	edge := mustStand(ctx, t, s, "edge", "edge")
	if err := s.prov.SetDefaultStand(ctx, admin(), edge.ID); err != nil {
		t.Fatalf("set default: %v", err)
	}
	list, _ := s.prov.ListStands(ctx)
	defaults := 0
	for _, st := range list {
		if st.Default {
			defaults++
			if st.ID != edge.ID {
				t.Fatalf("default stayed on %s", st.Name)
			}
		}
	}
	if defaults != 1 {
		t.Fatalf("want exactly one default, got %d", defaults)
	}
}
