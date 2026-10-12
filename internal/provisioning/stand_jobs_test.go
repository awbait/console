package provisioning_test

import (
	"context"
	"errors"
	"testing"

	"console/internal/provisioning"
	"console/pkg/models"
)

// consoleStandWithOrders makes a console-only stand on the configured group
// and places n orders on it, all kept in the portal.
func consoleStandWithOrders(ctx context.Context, t *testing.T, s *stack, n int) (*models.Stand, []*models.Request) {
	t.Helper()
	st := standInMode("moving", models.ModeConsole)
	st.GitPath = "managed-services"
	if err := s.prov.CreateStand(ctx, admin(), st); err != nil {
		t.Fatalf("create stand: %v", err)
	}
	var orders []*models.Request
	for i := 0; i < n; i++ {
		name := []string{"pg1", "pg2", "pg3"}[i]
		r, err := s.prov.Create(ctx, member("core"), newOrder(name, placed(name, st.ID)))
		if err != nil || r.Status != models.StatusConsoleSaved {
			t.Fatalf("create %s: %v %s", name, err, r.Status)
		}
		orders = append(orders, r)
	}
	return st, orders
}

func switchMode(ctx context.Context, t *testing.T, s *stack, st *models.Stand, mode string) *models.StandJob {
	t.Helper()
	got, err := s.prov.GetStand(ctx, st.ID)
	if err != nil {
		t.Fatalf("get stand: %v", err)
	}
	next := *got
	next.Mode = mode
	if err := s.prov.UpdateStand(ctx, admin(), &next); err != nil {
		t.Fatalf("switch to %s: %v", mode, err)
	}
	if next.Job == nil || next.Job.Total == 0 {
		t.Fatalf("switching a stand with orders to %s starts a job that counted them: %+v", mode, next.Job)
	}
	return next.Job
}

func job(ctx context.Context, t *testing.T, s *stack, id string) *models.StandJob {
	t.Helper()
	j, err := s.st.GetStandJob(ctx, id)
	if err != nil {
		t.Fatalf("get job: %v", err)
	}
	return j
}

// Console-only to Git-only and back: each order goes through a merge request
// that writes, then takes out, its files, and the job finishes once every
// order rests where the new mode keeps it.
func TestStandJobConsoleToGitAndBack(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	st, orders := consoleStandWithOrders(ctx, t, s, 2)

	j := switchMode(ctx, t, s, st, models.ModeGit)
	if err := s.prov.RunStandJobs(ctx); err != nil {
		t.Fatalf("pass: %v", err)
	}
	if got := job(ctx, t, s, j.ID); got.Total != 2 || got.Waiting != 2 || got.Status != models.StandJobRunning {
		t.Fatalf("after the first pass: %+v", got)
	}
	// While it runs, nothing about where the files go may change.
	busy, _ := s.prov.GetStand(ctx, st.ID)
	busy.Mode = models.ModeConsole
	var verr *provisioning.ValidationError
	if err := s.prov.UpdateStand(ctx, admin(), busy); !errors.As(err, &verr) || verr.Message != provisioning.MsgStandJobRunning {
		t.Fatalf("switching again while the job runs: %v", err)
	}
	for _, r := range orders {
		mrs, _ := s.st.ListMRs(ctx, r.ID)
		if len(mrs) != 1 || mrs[0].Action != models.ActionPublish {
			t.Fatalf("one publish change per order: %+v", mrs)
		}
	}
}

// One order there and back. One, because the GitLab fake merges a branch by
// replacing the target's tree with it: two branches cut from the same main
// would wipe each other's files, which real GitLab does not do.
func TestStandJobRoundTrip(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	st, orders := consoleStandWithOrders(ctx, t, s, 1)
	r := orders[0]

	j := switchMode(ctx, t, s, st, models.ModeGit)
	if err := s.prov.RunStandJobs(ctx); err != nil {
		t.Fatalf("pass: %v", err)
	}
	s.mergeLatestMR(ctx, t, r.ID)
	s.tick(ctx)
	if got := mustStatus(ctx, t, s.st, r.ID); got != models.StatusGitSaved {
		t.Fatalf("published order: %s", got)
	}
	if err := s.prov.RunStandJobs(ctx); err != nil {
		t.Fatalf("pass: %v", err)
	}
	if got := job(ctx, t, s, j.ID); got.Done != 1 || got.Status != models.StandJobDone || got.FinishedAt == nil {
		t.Fatalf("finished job: %+v", got)
	}

	// And back: the files go, the order stays in the portal.
	back := switchMode(ctx, t, s, st, models.ModeConsole)
	if err := s.prov.RunStandJobs(ctx); err != nil {
		t.Fatalf("pass: %v", err)
	}
	mrs, _ := s.st.ListMRs(ctx, r.ID)
	if mrs[len(mrs)-1].Action != models.ActionUnpublish {
		t.Fatalf("an unpublish change: %+v", mrs[len(mrs)-1])
	}
	s.mergeLatestMR(ctx, t, r.ID)
	s.tick(ctx)
	if got := mustStatus(ctx, t, s.st, r.ID); got != models.StatusConsoleSaved {
		t.Fatalf("unpublished order: %s", got)
	}
	proj, _ := s.gl.GetProject(ctx, "managed-services/team-core/postgres")
	if files, _ := s.gl.ListTree(ctx, proj.ID, "main", "in-cluster"); len(files) != 0 {
		t.Fatalf("the order's files are out of Git: %v", files)
	}
	if err := s.prov.RunStandJobs(ctx); err != nil {
		t.Fatalf("pass: %v", err)
	}
	if got := job(ctx, t, s, back.ID); got.Status != models.StandJobDone || got.Done != 1 {
		t.Fatalf("finished job back: %+v", got)
	}
}

// Git-only to deploy needs no change in Git: the orders go back to waiting
// for Argo CD on the first pass.
func TestStandJobGitToDeploy(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	st, orders := consoleStandWithOrders(ctx, t, s, 1)
	switchMode(ctx, t, s, st, models.ModeGit)
	_ = s.prov.RunStandJobs(ctx)
	s.mergeLatestMR(ctx, t, orders[0].ID)
	s.tick(ctx)
	_ = s.prov.RunStandJobs(ctx)

	j := switchMode(ctx, t, s, st, models.ModeDeploy)
	if err := s.prov.RunStandJobs(ctx); err != nil {
		t.Fatalf("pass: %v", err)
	}
	if got := job(ctx, t, s, j.ID); got.Status != models.StandJobDone || got.Done != 1 {
		t.Fatalf("git to deploy in one pass: %+v", got)
	}
	got := mustStatus(ctx, t, s.st, orders[0].ID)
	if got != models.StatusMRMerged {
		t.Fatalf("the order waits for Argo CD again: %s", got)
	}
}

// A change the job opened and somebody closed is a failure the job reports
// and does not retry; the order stays where it was.
func TestStandJobClosedChangeFails(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	st, orders := consoleStandWithOrders(ctx, t, s, 1)
	j := switchMode(ctx, t, s, st, models.ModeGit)
	_ = s.prov.RunStandJobs(ctx)
	mrs, _ := s.st.ListMRs(ctx, orders[0].ID)
	if err := s.gl.CloseMR(ctx, mrs[0].GitLabProjectID, mrs[0].MRIID); err != nil {
		t.Fatalf("close: %v", err)
	}
	s.tick(ctx)
	if got := mustStatus(ctx, t, s.st, orders[0].ID); got != models.StatusConsoleSaved {
		t.Fatalf("a closed publish leaves the order in the portal: %s", got)
	}
	_ = s.prov.RunStandJobs(ctx)
	got := job(ctx, t, s, j.ID)
	if got.Status != models.StandJobDone || len(got.Failures) != 1 || got.Failures[0].Reason != "mr_closed" || got.Failures[0].ServiceName != "pg1" {
		t.Fatalf("closed change: %+v", got)
	}
	if after, _ := s.st.ListMRs(ctx, orders[0].ID); len(after) != 1 {
		t.Fatalf("the job does not reopen what was closed: %d changes", len(after))
	}
}

// Stopping a job leaves what it moved and what it did not; a stopped job
// cannot be stopped again, and the stand may change once more.
func TestStopStandJob(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	st, _ := consoleStandWithOrders(ctx, t, s, 1)
	j := switchMode(ctx, t, s, st, models.ModeGit)
	if _, err := s.prov.StopStandJob(ctx, member("core"), st.ID, j.ID); !errors.Is(err, provisioning.ErrForbidden) {
		t.Fatalf("a member stops a job: %v", err)
	}
	stopped, err := s.prov.StopStandJob(ctx, admin(), st.ID, j.ID)
	if err != nil || stopped.Status != models.StandJobStopped || stopped.FinishedAt == nil {
		t.Fatalf("stop: %+v %v", stopped, err)
	}
	var verr *provisioning.ValidationError
	if _, err := s.prov.StopStandJob(ctx, admin(), st.ID, j.ID); !errors.As(err, &verr) || verr.Message != provisioning.MsgStandJobNotRunning {
		t.Fatalf("stop again: %v", err)
	}
	_ = s.prov.RunStandJobs(ctx)
	if got := job(ctx, t, s, j.ID); got.Status != models.StandJobStopped {
		t.Fatalf("a stopped job does not run: %+v", got)
	}
	jobs, err := s.prov.ListStandJobs(ctx, admin(), st.ID)
	if err != nil || len(jobs) != 1 {
		t.Fatalf("list: %d %v", len(jobs), err)
	}
	switchMode(ctx, t, s, st, models.ModeDeploy)
}
