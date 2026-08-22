package provisioning_test

import (
	"context"
	"testing"
	"time"

	"console/internal/cache"
	"console/internal/catalog"
	"console/internal/events"
	"console/internal/provisioning"
)

// A change that has just been opened is not news, whatever GitLab says about it.
// Mergeability is recomputed constantly, and the first answer is often "not
// now": announcing it puts "не удалось применить автоматически" in the history
// of an order that goes on to merge a minute later, and the person reading it
// has no way to tell that from a real problem.
func TestMergeBlockIsNotAnnouncedStraightAway(t *testing.T) {
	ctx := context.Background()
	s := newAutoMergeStack(t)
	req, mr := orderWithOpenMR(ctx, t, s)

	if err := s.gl.SetDetailedMergeStatus(mr.GitLabProjectID, mr.MRIID, "ci_must_pass"); err != nil {
		t.Fatalf("set merge status: %v", err)
	}
	for range 3 {
		s.tick(ctx)
	}

	if blocked := countEvents(ctx, t, s, req.ID, "merge_blocked"); len(blocked) != 0 {
		t.Fatalf("merge_blocked events = %d, want none while the change is this fresh",
			len(blocked))
	}
}

// A status this build does not recognise is not a failure to report. It is not
// something to stay silent about forever either: a change nobody can name a
// reason for, still unmerged half an hour later, is stuck.
func TestUnknownMergeStatusIsReportedOnlyOnceItIsStuck(t *testing.T) {
	ctx := context.Background()
	s := newAutoMergeStack(t)
	req, mr := orderWithOpenMR(ctx, t, s)

	if err := s.gl.SetDetailedMergeStatus(mr.GitLabProjectID, mr.MRIID, "gitlab_18_invented_this"); err != nil {
		t.Fatalf("set merge status: %v", err)
	}
	ageMR(ctx, t, s, req.ID, 10*time.Minute)
	s.tick(ctx)
	if blocked := countEvents(ctx, t, s, req.ID, "merge_blocked"); len(blocked) != 0 {
		t.Fatalf("merge_blocked events = %d, want none: ten minutes is not stuck", len(blocked))
	}

	ageMR(ctx, t, s, req.ID, time.Hour)
	s.tick(ctx)
	blocked := countEvents(ctx, t, s, req.ID, "merge_blocked")
	if len(blocked) != 1 {
		t.Fatalf("merge_blocked events = %d, want 1 once the change is plainly stuck", len(blocked))
	}
	if got := blocked[0].Payload["reason"]; got != "gitlab_18_invented_this" {
		t.Errorf("merge_blocked reason = %v, want GitLab's own word for it", got)
	}
}

// Restarting the portal must not re-announce what it already said. The reason a
// change is blocked used to live in the process, so every deploy wrote the same
// entry into the history of every order waiting for a person - which is what
// made the warning look like it was always there.
func TestMergeBlockSurvivesARestartWithoutRepeating(t *testing.T) {
	ctx := context.Background()
	s := newAutoMergeStack(t)
	req, mr := orderWithOpenMR(ctx, t, s)

	if err := s.gl.SetDetailedMergeStatus(mr.GitLabProjectID, mr.MRIID, "not_approved"); err != nil {
		t.Fatalf("set merge status: %v", err)
	}
	ageMR(ctx, t, s, req.ID, time.Hour)
	s.tick(ctx)
	if blocked := countEvents(ctx, t, s, req.ID, "merge_blocked"); len(blocked) != 1 {
		t.Fatalf("merge_blocked events = %d, want 1 before the restart", len(blocked))
	}

	// A fresh service over the same store: everything the old one held in memory
	// is gone, everything it wrote down is still there.
	restarted := provisioning.New(s.st, s.gl, s.argo,
		catalog.New(s.hb, cache.NewMemory()), s.gitops, events.New(), "in-cluster", "main", true)
	if err := restarted.Reconcile(ctx); err != nil {
		t.Fatalf("reconcile after restart: %v", err)
	}

	if blocked := countEvents(ctx, t, s, req.ID, "merge_blocked"); len(blocked) != 1 {
		t.Fatalf("merge_blocked events = %d, want the restart to add nothing", len(blocked))
	}
}
