package provisioning_test

import (
	"context"
	"errors"
	"testing"

	"console/internal/provisioning"
)

// A sync is asked of the order's application in Argo CD. A draft has none
// yet, and a deleted order none any more: since a deleted order can be
// restored under its name, the application that name points at may be the
// restored order's.
func TestForceSyncRefusesDraftsAndDeletedOrders(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	r, err := s.prov.Create(ctx, member("core"), newOrder("pg1"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	var verr *provisioning.ValidationError
	if err := s.prov.ForceSync(ctx, admin(), r.ID); !errors.As(err, &verr) || verr.Message != provisioning.MsgSyncDraft {
		t.Fatalf("sync of a draft: %v", err)
	}
	if _, err := s.prov.Delete(ctx, member("core"), r.ID); err != nil {
		t.Fatalf("delete draft: %v", err)
	}
	if err := s.prov.ForceSync(ctx, admin(), r.ID); !errors.As(err, &verr) || verr.Message != provisioning.MsgSyncDeleted {
		t.Fatalf("sync of a deleted order: %v", err)
	}
}
