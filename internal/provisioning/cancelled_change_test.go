package provisioning_test

import (
	"context"
	"testing"

	"console/internal/provisioning"
	"console/pkg/models"
)

// closeLatestMR closes the order's latest change without merging it - what
// somebody with repository access does when they decide a change is not going
// in after all.
func closeLatestMR(ctx context.Context, t *testing.T, s *stack, reqID string) {
	t.Helper()
	mrs, err := s.st.ListMRs(ctx, reqID)
	if err != nil || len(mrs) == 0 {
		t.Fatalf("no MRs for %s: %v", reqID, err)
	}
	latest := mrs[len(mrs)-1]
	if err := s.gl.CloseMR(ctx, latest.GitLabProjectID, latest.MRIID); err != nil {
		t.Fatalf("close: %v", err)
	}
}

// The case the portal used to lose a running service on: an edit of a live
// order is closed instead of merged. The service in the cluster is untouched by
// that, but the order went to MR_CLOSED - a state with no way out - so it could
// no longer be edited, upgraded or deleted, and the poller stopped watching it.
func TestCancelledEditLeavesTheOrderLive(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	r := liveOrder(ctx, t, s)

	openUpdateMR(ctx, t, s, r, map[string]any{"auth": map[string]any{"database": "mine"}})
	closeLatestMR(ctx, t, s, r.ID)
	s.tick(ctx)

	if got := mustStatus(ctx, t, s.st, r.ID); got != models.StatusDeploying {
		t.Fatalf("after a cancelled edit want DEPLOYING, got %s", got)
	}
	s.tick(ctx)
	if got := mustStatus(ctx, t, s.st, r.ID); got != models.StatusHealthy {
		t.Fatalf("the order should settle back to HEALTHY, got %s", got)
	}
	// Live again means the portal takes changes again: this is what MR_CLOSED
	// used to refuse for good.
	if _, err := s.prov.Update(ctx, member("core"), r.ID, provisioning.UpdateInput{
		Values: map[string]any{"auth": map[string]any{"database": "second"}},
	}); err != nil {
		t.Fatalf("edit after a cancelled edit: %v", err)
	}
}

// A deletion called off is the same story: the service was never removed, so
// the order goes back to being live rather than into a dead end.
func TestCancelledDeletionLeavesTheOrderLive(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	r := liveOrder(ctx, t, s)

	if _, err := s.prov.Delete(ctx, member("core"), r.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if got := mustStatus(ctx, t, s.st, r.ID); got != models.StatusDeleteRequested {
		t.Fatalf("want DELETE_REQUESTED, got %s", got)
	}
	closeLatestMR(ctx, t, s, r.ID)
	s.tick(ctx)

	if got := mustStatus(ctx, t, s.st, r.ID); got != models.StatusDeploying {
		t.Fatalf("after a cancelled deletion want DEPLOYING, got %s", got)
	}
	// And the service can be deleted again, this time for real.
	if _, err := s.prov.Delete(ctx, member("core"), r.ID); err != nil {
		t.Fatalf("delete after a cancelled deletion: %v", err)
	}
}

// The one closed change that does mean the order is over: the first one. There
// is no service behind it, so MR_CLOSED is the truth and stays terminal.
func TestCancelledFirstOrderIsTurnedDown(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	req, _ := orderWithOpenMR(ctx, t, s)

	closeLatestMR(ctx, t, s, req.ID)
	s.tick(ctx)

	if got := mustStatus(ctx, t, s.st, req.ID); got != models.StatusMRClosed {
		t.Fatalf("want MR_CLOSED, got %s", got)
	}
}
