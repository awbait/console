package provisioning_test

import (
	"context"
	"testing"
	"time"

	"console/internal/argocd"
	"console/internal/provisioning"
	"console/pkg/models"
)

// An upgrade does not reach the application in one piece: values.yaml is read
// straight from the branch, while the new chart version waits for the
// app-of-apps to apply the manifest. In between, ArgoCD holds the old chart
// against the new values and says so, loudly and truthfully, about a state
// nobody asked for. That complaint used to become the order's status.
const upgradeComplaint = "ComparisonError: Failed to load target state: " +
	"values don't meet the specifications of the schema(s) in the following chart(s)"

// deployed creates an order on 15.4.1, merges it and leaves it in DEPLOYING.
func deployed(ctx context.Context, t *testing.T, s *stack, name string) *models.Request {
	t.Helper()
	req, err := s.prov.Create(ctx, member("core"), provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.1",
		Team: "core", ServiceName: name, Values: validValues(),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	s.mergeLatestMR(ctx, t, req.ID)
	s.tick(ctx)
	return req
}

// upgrade moves the order to 15.4.2 and merges the change, leaving it in
// MR_MERGED - the state an upgrade is in when ArgoCD has not seen it yet.
func upgrade(ctx context.Context, t *testing.T, s *stack, id string) {
	t.Helper()
	if _, err := s.prov.Update(ctx, member("core"), id, provisioning.UpdateInput{
		Version: "15.4.2", Values: validValues(),
	}); err != nil {
		t.Fatalf("upgrade: %v", err)
	}
	s.mergeLatestMR(ctx, t, id)
}

// deploying is upgrade() carried one step further, to where the order waits for
// the new version to arrive.
func deploying(ctx context.Context, t *testing.T, s *stack, id string) {
	t.Helper()
	upgrade(ctx, t, s, id)
	_ = s.prov.Reconcile(ctx)
	if got := mustStatus(ctx, t, s.st, id); got != models.StatusDeploying {
		t.Fatalf("order in %s after the upgrade merged, want DEPLOYING", got)
	}
}

// While the application is still the previous version, what it reports is about
// the previous version: the failure is not the order's to answer for, and the
// health is not the order's to take credit for either.
func TestAFailureOnThePreviousVersionIsNotTheOrdersFailure(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	req := deployed(ctx, t, s, "pg-upgrade")
	upgrade(ctx, t, s, req.ID)

	// The application as it is mid-upgrade: still on 15.4.1, healthy on what it
	// deployed before, complaining about values it cannot template.
	s.argo.Upsert(argocd.Application{
		Name:         req.ArgoCDAppName,
		Cluster:      "in-cluster",
		Health:       argocd.HealthHealthy,
		Sync:         argocd.SyncUnknown,
		ChartVersion: "15.4.1",
		Error:        upgradeComplaint,
		ErrorSince:   time.Now(),
	})
	syncs := s.argo.Syncs(req.ArgoCDAppName)

	_ = s.prov.Reconcile(ctx)

	switch got := mustStatus(ctx, t, s.st, req.ID); got {
	case models.StatusDegraded:
		t.Fatal("the order was failed over a complaint about the version it is leaving")
	case models.StatusHealthy:
		t.Fatal("the order was called deployed while its new version had not arrived")
	case models.StatusDeploying: // waiting, which is what it is doing
	default:
		t.Fatalf("order in %s mid-upgrade", got)
	}
	if n := s.argo.Syncs(req.ArgoCDAppName) - syncs; n != 0 {
		t.Fatalf("the portal ran %d syncs of the old chart against the new values", n)
	}
}

// ArgoCD does not retry a sync it has already tried for a revision, so once the
// application catches up, the failure of the previous version just sits there
// and nothing applies the new one. Asking once more is the whole fix.
func TestTheSyncLeftFailedOnThePreviousVersionIsRunAgain(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	req := deployed(ctx, t, s, "pg-resync")
	deploying(ctx, t, s, req.ID)

	s.argo.Upsert(argocd.Application{
		Name:         req.ArgoCDAppName,
		Cluster:      "in-cluster",
		Health:       argocd.HealthHealthy,
		Sync:         argocd.SyncOutOfSync,
		ChartVersion: "15.4.2", // the manifest has been applied by now
		Error:        upgradeComplaint,
		ErrorSince:   time.Now().Add(-10 * time.Minute),
		LastOp: &argocd.Operation{
			Phase:        argocd.OpFailed,
			ChartVersion: "15.4.1", // but the sync that failed was for the old one
			FinishedAt:   time.Now().Add(-10 * time.Minute),
		},
	})

	syncs := s.argo.Syncs(req.ArgoCDAppName)

	_ = s.prov.Reconcile(ctx)

	if got := mustStatus(ctx, t, s.st, req.ID); got != models.StatusDeploying {
		t.Fatalf("order in %s, want DEPLOYING while the sync is re-run", got)
	}
	if n := s.argo.Syncs(req.ArgoCDAppName) - syncs; n != 1 {
		t.Fatalf("the portal asked for %d syncs, want exactly one", n)
	}

	// And it leaves ArgoCD alone until that sync has had a chance to happen: the
	// reconciler comes back every few seconds.
	_ = s.prov.Reconcile(ctx)
	if n := s.argo.Syncs(req.ArgoCDAppName) - syncs; n != 1 {
		t.Fatalf("the portal asked again on the next tick (%d syncs)", n)
	}
}

// A sync that failed on the version being ordered is an answer: the values do
// not work with the chart the order asks for, and nothing else is going to fix
// that. The order says so, with what ArgoCD said.
func TestAFailureOnTheOrderedVersionFailsTheOrder(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	req := deployed(ctx, t, s, "pg-broken")
	deploying(ctx, t, s, req.ID)

	s.argo.Upsert(argocd.Application{
		Name:         req.ArgoCDAppName,
		Cluster:      "in-cluster",
		Health:       argocd.HealthHealthy,
		Sync:         argocd.SyncOutOfSync,
		ChartVersion: "15.4.2",
		Error:        upgradeComplaint,
		ErrorSince:   time.Now().Add(-10 * time.Minute),
		LastOp: &argocd.Operation{
			Phase:        argocd.OpFailed,
			ChartVersion: "15.4.2",
			FinishedAt:   time.Now().Add(-time.Minute),
		},
	})

	_ = s.prov.Reconcile(ctx)

	if got := mustStatus(ctx, t, s.st, req.ID); got != models.StatusDegraded {
		t.Fatalf("order in %s, want DEGRADED after the ordered version failed to sync", got)
	}
}

// A sync ArgoCD is retrying has not gone through, however much it looks like
// one: between attempts the operation is Running and carries the time of the
// failure as its finish time. The condition it keeps failing on is still the
// answer, and the order does not wait out the whole retry schedule for it.
func TestAComplaintIsNotOutlivedByASyncArgoCDIsRetrying(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	req := deployed(ctx, t, s, "pg-retried")
	deploying(ctx, t, s, req.ID)

	s.argo.Upsert(argocd.Application{
		Name:         req.ArgoCDAppName,
		Cluster:      "in-cluster",
		Health:       argocd.HealthHealthy, // the previous release is still running
		Sync:         argocd.SyncUnknown,
		ChartVersion: "15.4.2",
		Error:        upgradeComplaint,
		ErrorSince:   time.Now().Add(-10 * time.Minute),
		LastOp: &argocd.Operation{
			Phase:        argocd.OpRunning,
			ChartVersion: "15.4.2",
			Message:      upgradeComplaint + ". Retrying attempt #2 at 2026-09-24T10:04:07Z.",
			FinishedAt:   time.Now().Add(-30 * time.Second),
		},
	})

	_ = s.prov.Reconcile(ctx)

	if got := mustStatus(ctx, t, s.st, req.ID); got != models.StatusDegraded {
		t.Fatalf("order in %s, want DEGRADED while ArgoCD retries a sync that keeps failing", got)
	}
}

// A condition older than a sync that went through describes a state ArgoCD has
// since left. The application is healthy and synced; the order follows it.
func TestAComplaintOlderThanASuccessfulSyncIsIgnored(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	req := deployed(ctx, t, s, "pg-recovered")
	deploying(ctx, t, s, req.ID)

	s.argo.Upsert(argocd.Application{
		Name:         req.ArgoCDAppName,
		Cluster:      "in-cluster",
		Health:       argocd.HealthHealthy,
		Sync:         argocd.SyncSynced,
		ChartVersion: "15.4.2",
		Error:        upgradeComplaint,
		ErrorSince:   time.Now().Add(-10 * time.Minute),
		LastOp: &argocd.Operation{
			Phase:        argocd.OpSucceeded,
			ChartVersion: "15.4.2",
			FinishedAt:   time.Now().Add(-time.Minute),
		},
	})

	_ = s.prov.Reconcile(ctx)

	if got := mustStatus(ctx, t, s.st, req.ID); got != models.StatusHealthy {
		t.Fatalf("order in %s, want HEALTHY after a sync that went through", got)
	}
}

// An application ArgoCD cannot build never gets a sync to judge by, so the
// condition speaks for itself - but only once it has held long enough to be
// about something more than the moment it was read in.
func TestAFreshComplaintWithNoSyncWaitsBeforeFailingTheOrder(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	req := deployed(ctx, t, s, "pg-unbuildable")

	fresh := argocd.Application{
		Name:         req.ArgoCDAppName,
		Cluster:      "in-cluster",
		Health:       argocd.HealthUnknown,
		Sync:         argocd.SyncUnknown,
		ChartVersion: "15.4.1",
		Error:        upgradeComplaint,
		ErrorSince:   time.Now(),
	}
	s.argo.Upsert(fresh)
	_ = s.prov.Reconcile(ctx)
	if got := mustStatus(ctx, t, s.st, req.ID); got != models.StatusDeploying {
		t.Fatalf("order in %s, want DEPLOYING while the complaint is seconds old", got)
	}

	held := fresh
	held.ErrorSince = time.Now().Add(-10 * time.Minute)
	s.argo.Upsert(held)
	_ = s.prov.Reconcile(ctx)
	if got := mustStatus(ctx, t, s.st, req.ID); got != models.StatusDegraded {
		t.Fatalf("order in %s, want DEGRADED once the complaint has held", got)
	}
}

// A person who fixes one failure hits the next one, and the order used to go on
// explaining the failure they had already dealt with: the reason was written
// once, on the way into DEGRADED, and never again.
func TestANewReasonForTheSameFailureIsWrittenDown(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	req := deployed(ctx, t, s, "pg-two-reasons")

	const first = "ComparisonError: got object, want array"
	const second = "ComparisonError: mode direct has no waypoint"
	broken := argocd.Application{
		Name:         req.ArgoCDAppName,
		Cluster:      "in-cluster",
		Health:       argocd.HealthUnknown,
		Sync:         argocd.SyncUnknown,
		ChartVersion: "15.4.1",
		Error:        first,
		ErrorSince:   time.Now().Add(-10 * time.Minute),
	}
	s.argo.Upsert(broken)
	_ = s.prov.Reconcile(ctx)
	if got := mustStatus(ctx, t, s.st, req.ID); got != models.StatusDegraded {
		t.Fatalf("order in %s, want DEGRADED", got)
	}

	// The same reason a few ticks later has nothing to add.
	_ = s.prov.Reconcile(ctx)
	_ = s.prov.Reconcile(ctx)
	if n := len(appErrorReasons(ctx, t, s, req.ID)); n != 1 {
		t.Fatalf("the same reason was written %d times", n)
	}

	broken.Error = second
	broken.ErrorSince = time.Now()
	s.argo.Upsert(broken)
	_ = s.prov.Reconcile(ctx)

	reasons := appErrorReasons(ctx, t, s, req.ID)
	if len(reasons) != 2 {
		t.Fatalf("the order holds %d reasons, want both: %v", len(reasons), reasons)
	}
	if reasons[1] != second {
		t.Errorf("the new reason did not reach the order: %q", reasons[1])
	}

	// And it, too, is said once.
	_ = s.prov.Reconcile(ctx)
	if n := len(appErrorReasons(ctx, t, s, req.ID)); n != 2 {
		t.Fatalf("the new reason was written %d times", n)
	}
}

// appErrorReasons lists the deployment failures written into an order's history,
// oldest first.
func appErrorReasons(ctx context.Context, t *testing.T, s *stack, id string) []string {
	t.Helper()
	events, err := s.st.ListEvents(ctx, id)
	if err != nil {
		t.Fatalf("events: %v", err)
	}
	var out []string
	for _, e := range events {
		if e.EventType == "app_error" {
			reason, _ := e.Payload["error"].(string)
			out = append(out, reason)
		}
	}
	return out
}
