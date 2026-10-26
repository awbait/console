package provisioning_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"console/internal/provisioning"
	"console/pkg/models"
)

// deployStandWithOrders makes a deploying stand on the configured group and
// places n orders on it, merged and on their way.
func deployStandWithOrders(ctx context.Context, t *testing.T, s *stack, n int) (*models.Stand, []*models.Request) {
	t.Helper()
	st := standInMode("edp", models.ModeDeploy)
	st.GitPath = "managed-services"
	if err := s.prov.CreateStand(ctx, admin(), st); err != nil {
		t.Fatalf("create stand: %v", err)
	}
	var orders []*models.Request
	for i := 0; i < n; i++ {
		name := []string{"pg1", "pg2", "pg3"}[i]
		r, err := s.prov.Create(ctx, member("core"), newOrder(name, placed(name, st.ID)))
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		s.mergeLatestMR(ctx, t, r.ID)
		orders = append(orders, r)
	}
	s.tick(ctx)
	return st, orders
}

// appAt reads the order's application.yaml at a ref of the chart repository.
func appAt(ctx context.Context, t *testing.T, s *stack, r *models.Request, ref string) string {
	t.Helper()
	proj, err := s.gl.GetProject(ctx, "managed-services/team-core/postgres")
	if err != nil {
		t.Fatalf("repo: %v", err)
	}
	app, err := s.gl.GetFile(ctx, proj.ID, s.gitops.AppPath(r), ref)
	if err != nil {
		t.Fatalf("application.yaml of %s at %s: %v", r.ServiceName, ref, err)
	}
	return string(app)
}

// setProject changes the stand's Argo CD project, which the orders already
// placed keep in Git until a regeneration writes their manifests again.
func setProject(ctx context.Context, t *testing.T, s *stack, st *models.Stand, project string) {
	t.Helper()
	cur, err := s.prov.GetStand(ctx, st.ID)
	if err != nil {
		t.Fatalf("get stand: %v", err)
	}
	next := *cur
	next.ArgoProject = project
	if err := s.prov.UpdateStand(ctx, admin(), &next); err != nil {
		t.Fatalf("change the project: %v", err)
	}
}

// One order through the whole cycle: the stand's project changes, the
// regeneration opens one change with the application alone, the order goes
// for approval the way an edit sends it, the merged manifest names the new
// project and nothing else about the order moved. A second regeneration
// finds the manifest already right and skips the order.
func TestRegenerateWritesTheChangedManifest(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	st, orders := deployStandWithOrders(ctx, t, s, 1)
	r := orders[0]
	if n, err := s.prov.PreviewRegenerate(ctx, admin(), st.ID); err != nil || n != 1 {
		t.Fatalf("preview counts the placed orders: %d %v", n, err)
	}
	setProject(ctx, t, s, st, "edp-next")
	j, err := s.prov.RegenerateStand(ctx, admin(), st.ID)
	if err != nil || j.Total != 1 || j.Kind != models.StandJobRegenerate {
		t.Fatalf("start: %+v %v", j, err)
	}
	if _, err := s.prov.RegenerateStand(ctx, admin(), st.ID); err == nil {
		t.Fatal("a second regeneration while one runs is refused")
	}
	if err := s.prov.RunStandJobs(ctx); err != nil {
		t.Fatalf("pass: %v", err)
	}
	got := job(ctx, t, s, j.ID)
	if got.Status != models.StandJobDone || got.Done != 1 || got.Skipped != 0 || len(got.Failures) != 0 {
		t.Fatalf("the manifest differs, the order is updated in one pass: %+v", got)
	}
	if st := mustStatus(ctx, t, s.st, r.ID); st != models.StatusMRCreated {
		t.Fatalf("the order goes for approval the way an edit does: %s", st)
	}
	mrs, _ := s.st.ListMRs(ctx, r.ID)
	if len(mrs) != 2 || mrs[1].Action != models.ActionRegenerate {
		t.Fatalf("one regeneration change: %+v", mrs)
	}
	if !strings.Contains(appAt(ctx, t, s, r, "main"), "project: "+s.gitops.ArgoProject) {
		t.Fatal("nothing lands before the merge")
	}
	s.mergeLatestMR(ctx, t, r.ID)
	s.tick(ctx)
	if app := appAt(ctx, t, s, r, "main"); !strings.Contains(app, "project: edp-next") {
		t.Fatalf("merged, the manifest names the new project:\n%s", app)
	}
	fresh, _ := s.st.GetRequest(ctx, r.ID)
	if fresh.ValuesYAML != r.ValuesYAML || fresh.ChartVersion != r.ChartVersion {
		t.Fatalf("values and version are not the regeneration's to change: %+v", fresh)
	}
	if fresh.Status == models.StatusMRCreated {
		t.Fatalf("after the merge the order is on its way again: %s", fresh.Status)
	}

	// Again: the manifest already says what the stand says.
	j2, err := s.prov.RegenerateStand(ctx, admin(), st.ID)
	if err != nil {
		t.Fatalf("second start: %v", err)
	}
	if err := s.prov.RunStandJobs(ctx); err != nil {
		t.Fatalf("second pass: %v", err)
	}
	got = job(ctx, t, s, j2.ID)
	if got.Status != models.StandJobDone || got.Done != 0 || got.Skipped != 1 {
		t.Fatalf("nothing to write, the order is skipped: %+v", got)
	}
	if mrs, _ := s.st.ListMRs(ctx, r.ID); len(mrs) != 2 {
		t.Fatalf("a change the order did not need: %d", len(mrs))
	}
}

// Several orders in one pass: each gets its own change carrying the new
// manifest, and the job counts them all at once. (The fake GitLab merges a
// branch as a snapshot of the whole repository, so merging these three in a
// row is not what a real GitLab would do; the one-order test covers the
// merge.)
func TestRegenerateHandlesABatch(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	st, orders := deployStandWithOrders(ctx, t, s, 3)
	setProject(ctx, t, s, st, "edp-next")
	j, err := s.prov.RegenerateStand(ctx, admin(), st.ID)
	if err != nil || j.Total != 3 {
		t.Fatalf("start: %+v %v", j, err)
	}
	if err := s.prov.RunStandJobs(ctx); err != nil {
		t.Fatalf("pass: %v", err)
	}
	if got := job(ctx, t, s, j.ID); got.Status != models.StandJobDone || got.Done != 3 || got.Skipped != 0 {
		t.Fatalf("three changes in one pass: %+v", got)
	}
	for _, r := range orders {
		mrs, _ := s.st.ListMRs(ctx, r.ID)
		if len(mrs) != 2 || mrs[1].Action != models.ActionRegenerate {
			t.Fatalf("%s carries one regeneration change: %+v", r.ServiceName, mrs)
		}
		mr, err := s.gl.GetMR(ctx, mrs[1].GitLabProjectID, mrs[1].MRIID)
		if err != nil {
			t.Fatalf("mr of %s: %v", r.ServiceName, err)
		}
		if app := appAt(ctx, t, s, r, mr.SourceBranch); !strings.Contains(app, "project: edp-next") {
			t.Fatalf("the change of %s carries the new project:\n%s", r.ServiceName, app)
		}
	}
}

// An order with a change of its own open is waited on and written once the
// change lands; a regeneration change closed without merging is a failure
// the job reports and does not retry. Drafts are not the job's business, a
// stand that keeps its orders in the portal has nothing to write, and only
// an admin starts one.
func TestRegenerateWaitsAndReportsClosedChanges(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	st, orders := deployStandWithOrders(ctx, t, s, 2)
	// pg2 is being edited by its owner: its change is open.
	if _, err := s.prov.Update(ctx, member("core"), orders[1].ID, provisioning.UpdateInput{
		Values: map[string]any{"auth": map[string]any{"database": "second"}},
	}); err != nil {
		t.Fatalf("edit pg2: %v", err)
	}
	// A draft on the stand is not looked at.
	if _, err := s.prov.Create(ctx, member("core"), newOrder("pg3", onStand(st.ID))); err != nil {
		t.Fatalf("draft: %v", err)
	}
	setProject(ctx, t, s, st, "edp-next")
	j, err := s.prov.RegenerateStand(ctx, admin(), st.ID)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if err := s.prov.RunStandJobs(ctx); err != nil {
		t.Fatalf("pass: %v", err)
	}
	got := job(ctx, t, s, j.ID)
	if got.Status != models.StandJobRunning || got.Total != 2 || got.Done != 1 || got.Waiting != 1 {
		t.Fatalf("pg1 is written, pg2 is the owner's until its edit lands, pg3 is a draft: %+v", got)
	}
	// The regeneration change of pg1 is closed by hand.
	mrs, _ := s.st.ListMRs(ctx, orders[0].ID)
	if err := s.gl.CloseMR(ctx, mrs[1].GitLabProjectID, mrs[1].MRIID); err != nil {
		t.Fatalf("close: %v", err)
	}
	s.tick(ctx)
	// The owner's edit of pg2 merges, written before the project changed, so
	// pg2 is the job's to write now.
	s.mergeLatestMR(ctx, t, orders[1].ID)
	s.tick(ctx)
	if err := s.prov.RunStandJobs(ctx); err != nil {
		t.Fatalf("second pass: %v", err)
	}
	got = job(ctx, t, s, j.ID)
	if len(got.Failures) != 1 || got.Failures[0].Reason != "mr_closed" || got.Failures[0].ServiceName != "pg1" {
		t.Fatalf("the closed change is reported against pg1: %+v", got)
	}
	if got.Status != models.StandJobDone || got.Done != 1 || got.Skipped != 0 {
		t.Fatalf("pg2 written, pg1 given up on, job done: %+v", got)
	}
	if after, _ := s.st.ListMRs(ctx, orders[0].ID); len(after) != 2 {
		t.Fatalf("the job does not reopen what was closed: %d changes", len(after))
	}
	if after, _ := s.st.ListMRs(ctx, orders[1].ID); len(after) != 3 || after[2].Action != models.ActionRegenerate {
		t.Fatalf("pg2 got its regeneration change after its edit: %+v", after)
	}

	// A stand that keeps its orders in the portal has nothing to write.
	console := standInMode("kept", models.ModeConsole)
	console.GitPath = "managed-services"
	if err := s.prov.CreateStand(ctx, admin(), console); err != nil {
		t.Fatalf("create console stand: %v", err)
	}
	var verr *provisioning.ValidationError
	if _, err := s.prov.RegenerateStand(ctx, admin(), console.ID); !errors.As(err, &verr) || verr.Message != provisioning.MsgRegenerateMode {
		t.Fatalf("console stand: %v", err)
	}
	if _, err := s.prov.PreviewRegenerate(ctx, admin(), console.ID); !errors.As(err, &verr) {
		t.Fatalf("console stand preview: %v", err)
	}
	if _, err := s.prov.RegenerateStand(ctx, member("core"), st.ID); !errors.Is(err, provisioning.ErrForbidden) {
		t.Fatalf("not an admin: %v", err)
	}
}
