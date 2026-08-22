package provisioning_test

import (
	"context"
	"testing"
	"time"

	"console/internal/argocd"
	"console/internal/cache"
	"console/internal/catalog"
	"console/internal/events"
	"console/internal/gitlab"
	"console/internal/harbor"
	"console/internal/provisioning"
	"console/internal/store"
	"console/pkg/models"
)

// newAutoMergeStack is newStack with the poller's auto-merge on: the portal
// merges its own MRs, which is the path these tests exercise. The GitLab fake
// itself still merges nothing on its own, so the MR stays open until the
// reconcile loop decides to merge it.
func newAutoMergeStack(t *testing.T) *stack {
	t.Helper()
	st := store.NewMemory()
	c := cache.NewMemory()
	hb := harbor.NewFake()
	gl := gitlab.NewFake("managed-services", []string{"team-core"}, false)
	argo := argocd.NewFake(gl)
	cat := catalog.New(hb, c)
	gitops, err := provisioning.NewGitOps("managed-services", "team-{{.Team}}",
		"{{.Team}}-{{.Chart}}-{{.ServiceName}}", "portal-managed", "main")
	if err != nil {
		t.Fatal(err)
	}
	prov := provisioning.New(st, gl, argo, cat, gitops, events.New(), "in-cluster", "main", true)
	return &stack{prov, gl, argo, hb, st, gitops}
}

// orderWithOpenMR creates an order and returns it with its open MR record.
func orderWithOpenMR(ctx context.Context, t *testing.T, s *stack) (*models.Request, *models.RequestMR) {
	t.Helper()
	req, err := s.prov.Create(ctx, member("core"), provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "pg1", Values: validValues(),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	mrs, err := s.st.ListMRs(ctx, req.ID)
	if err != nil || len(mrs) == 0 {
		t.Fatalf("no MRs for %s: %v", req.ID, err)
	}
	return req, mrs[len(mrs)-1]
}

// ageMR backdates an order's latest change, so the portal sees one that has been
// refused for a while rather than one opened a moment ago. Announcing a block is
// deliberately not immediate (see the grace periods in reconcile.go), and no test
// is going to sit out the real thing.
func ageMR(ctx context.Context, t *testing.T, s *stack, reqID string, by time.Duration) {
	t.Helper()
	mrs, err := s.st.ListMRs(ctx, reqID)
	if err != nil || len(mrs) == 0 {
		t.Fatalf("no MRs for %s: %v", reqID, err)
	}
	mr := mrs[len(mrs)-1]
	mr.CreatedAt = mr.CreatedAt.Add(-by)
	if err := s.st.UpdateMR(ctx, mr); err != nil {
		t.Fatalf("age mr: %v", err)
	}
}

func mrStatus(ctx context.Context, t *testing.T, s *stack, reqID string) models.MRStatus {
	t.Helper()
	mrs, err := s.st.ListMRs(ctx, reqID)
	if err != nil || len(mrs) == 0 {
		t.Fatalf("no MRs for %s: %v", reqID, err)
	}
	return mrs[len(mrs)-1].Status
}

func countEvents(ctx context.Context, t *testing.T, s *stack, reqID, typ string) []*models.RequestEvent {
	t.Helper()
	evs, err := s.st.ListEvents(ctx, reqID)
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	var out []*models.RequestEvent
	for _, e := range evs {
		if e.EventType == typ {
			out = append(out, e)
		}
	}
	return out
}

// A merge GitLab will never accept must stop the retry loop and say why once,
// however many times the poller comes back around. Before this, the order sat
// in MR_CREATED forever while the poller re-attempted the merge every tick and
// logged nothing above Debug.
//
// The gate here is one only a person can open (a pipeline). A conflict is the
// other kind - the portal clears those itself, which is what retry_test.go is
// about.
func TestAutoMergeBlockedReportsOnceAndStopsRetrying(t *testing.T) {
	ctx := context.Background()
	s := newAutoMergeStack(t)
	req, mr := orderWithOpenMR(ctx, t, s)

	if err := s.gl.SetDetailedMergeStatus(mr.GitLabProjectID, mr.MRIID, "ci_must_pass"); err != nil {
		t.Fatalf("set merge status: %v", err)
	}
	ageMR(ctx, t, s, req.ID, time.Hour)
	for range 3 {
		s.tick(ctx)
	}

	if got := mrStatus(ctx, t, s, req.ID); got != models.MROpened {
		t.Errorf("MR status = %q, want %q: a blocked MR must not be merged", got, models.MROpened)
	}
	mrs, err := s.st.ListMRs(ctx, req.ID)
	if err != nil {
		t.Fatalf("list mrs: %v", err)
	}
	if len(mrs) != 1 {
		t.Errorf("merge requests = %d, want the change left as it is: rewriting it clears no gate", len(mrs))
	}
	blocked := countEvents(ctx, t, s, req.ID, "merge_blocked")
	if len(blocked) != 1 {
		t.Fatalf("merge_blocked events = %d, want 1 (one per block, not one per tick)", len(blocked))
	}
	if got := blocked[0].Payload["reason"]; got != "ci_must_pass" {
		t.Errorf("merge_blocked reason = %v, want %q", got, "ci_must_pass")
	}
}

// While GitLab is still computing mergeability the order is not stuck, just
// early: no report, and the merge goes through as soon as the status clears.
func TestAutoMergePendingWaitsThenMerges(t *testing.T) {
	ctx := context.Background()
	s := newAutoMergeStack(t)
	req, mr := orderWithOpenMR(ctx, t, s)

	if err := s.gl.SetDetailedMergeStatus(mr.GitLabProjectID, mr.MRIID, "checking"); err != nil {
		t.Fatalf("set merge status: %v", err)
	}
	s.tick(ctx)
	if got := mrStatus(ctx, t, s, req.ID); got != models.MROpened {
		t.Errorf("MR status = %q, want %q while GitLab is still checking", got, models.MROpened)
	}
	if n := len(countEvents(ctx, t, s, req.ID, "merge_blocked")); n != 0 {
		t.Errorf("merge_blocked events = %d, want 0: checking is not a block", n)
	}

	if err := s.gl.SetDetailedMergeStatus(mr.GitLabProjectID, mr.MRIID, "mergeable"); err != nil {
		t.Fatalf("set merge status: %v", err)
	}
	s.tick(ctx)
	if got := mrStatus(ctx, t, s, req.ID); got != models.MRMerged {
		t.Errorf("MR status = %q, want %q once GitLab reports it mergeable", got, models.MRMerged)
	}
}

// An instance that reports no mergeability at all (GitLab older than 15.6, or
// the fake) must keep the original behaviour: try the merge and see.
func TestAutoMergeWithoutReportedStatusStillMerges(t *testing.T) {
	ctx := context.Background()
	s := newAutoMergeStack(t)
	req, _ := orderWithOpenMR(ctx, t, s)

	s.tick(ctx)

	if got := mrStatus(ctx, t, s, req.ID); got != models.MRMerged {
		t.Errorf("MR status = %q, want %q", got, models.MRMerged)
	}
}
