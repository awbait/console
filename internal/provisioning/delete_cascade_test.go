package provisioning_test

import (
	"context"
	"testing"

	"console/pkg/models"
)

// Deleting an order has to take the running service with it, not just the record
// of it. The portal removes the manifest from Git and the app-of-apps prunes the
// Argo CD Application; an Application without the resources finalizer is pruned
// on its own and leaves everything it deployed running in the cluster, owned by
// nothing and invisible to the portal.
//
// The portal therefore asks Argo CD to cascade BEFORE the change removing the
// manifest is opened. After that moment the application is on its way out and
// there is nothing left to ask.
func TestDeleteMakesTheApplicationCascade(t *testing.T) {
	ctx := context.Background()
	s := newAutoStack(t)
	u := member("core")

	r := createHealthy(ctx, t, s, u, "pg1")
	if s.argo.CascadesOnDelete(r.ArgoCDAppName) {
		t.Fatal("a live order must not be prepared for deletion")
	}

	if _, err := s.prov.Delete(ctx, u, r.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if !s.argo.CascadesOnDelete(r.ArgoCDAppName) {
		t.Fatal("the application was not made to take its resources with it: " +
			"deleting the order would leave the service running")
	}
}

// A service Argo CD does not know about is still deletable from Git. Refusing
// would strand the order: its manifests would stay committed forever because the
// one thing that could remove them is the delete the portal just declined.
func TestDeleteProceedsWhenArgoCDHasNoApplication(t *testing.T) {
	ctx := context.Background()
	s := newAutoStack(t)
	u := member("core")

	r := createHealthy(ctx, t, s, u, "pg1")
	s.argo.Forget(r.ArgoCDAppName)

	if _, err := s.prov.Delete(ctx, u, r.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if got := mustStatus(ctx, t, s.st, r.ID); got != models.StatusDeleteRequested &&
		got != models.StatusDeleteMRMerged && got != models.StatusDeleted {
		t.Fatalf("delete did not start: status %s", got)
	}
}
