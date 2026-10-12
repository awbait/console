package provisioning_test

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"console/internal/provisioning"
	"console/pkg/models"
)

// What deleting a stand refuses: a member, a wrong name, the default stand,
// the last one, and a stand that already has a job running.
func TestDeleteStandRefusals(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	def := standInMode("main", models.ModeDeploy)
	if err := s.prov.CreateStand(ctx, admin(), def); err != nil {
		t.Fatalf("create stand: %v", err)
	}
	var verr *provisioning.ValidationError
	if _, err := s.prov.DeleteStand(ctx, admin(), def.ID, "main"); !errors.As(err, &verr) || verr.Message != provisioning.MsgStandDeleteDefault {
		t.Fatalf("the default stand: %v", err)
	}
	other := standInMode("other", models.ModeConsole)
	other.GitPath = "managed-services"
	if err := s.prov.CreateStand(ctx, admin(), other); err != nil {
		t.Fatalf("create stand: %v", err)
	}
	if _, err := s.prov.DeleteStand(ctx, member("core"), other.ID, "other"); !errors.Is(err, provisioning.ErrForbidden) {
		t.Fatalf("a member: %v", err)
	}
	if _, err := s.prov.DeleteStand(ctx, admin(), other.ID, "othr"); !errors.As(err, &verr) || verr.Message != provisioning.MsgStandDeleteName {
		t.Fatalf("a wrong name: %v", err)
	}
	if err := s.prov.SetDefaultStand(ctx, admin(), other.ID); err != nil {
		t.Fatalf("move default: %v", err)
	}
	// Two stands, the other one default: deleting "main" leaves one, fine;
	// deleting the last one is not.
	if _, err := s.prov.DeleteStand(ctx, admin(), def.ID, "main"); err != nil {
		t.Fatalf("delete main: %v", err)
	}
	_ = s.prov.RunStandJobs(ctx)
	if err := s.prov.SetDefaultStand(ctx, admin(), def.ID); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("a deleted stand cannot become default: %v", err)
	}

	solo := newStack(t)
	only := standInMode("only", models.ModeDeploy)
	if err := solo.prov.CreateStand(ctx, admin(), only); err != nil {
		t.Fatalf("create stand: %v", err)
	}
	second := standInMode("second", models.ModeConsole)
	if err := solo.prov.CreateStand(ctx, admin(), second); err != nil {
		t.Fatalf("create stand: %v", err)
	}
	if _, err := solo.prov.Create(ctx, member("core"), newOrder("pg1", placed("pg1", second.ID))); err != nil {
		t.Fatalf("create: %v", err)
	}
	toGit := *second
	toGit.Mode = models.ModeGit
	if err := solo.prov.UpdateStand(ctx, admin(), &toGit); err != nil {
		t.Fatalf("start a mode job: %v", err)
	}
	if _, err := solo.prov.DeleteStand(ctx, admin(), second.ID, "second"); !errors.As(err, &verr) || verr.Message != provisioning.MsgStandDeleteJob {
		t.Fatalf("a stand with a job running: %v", err)
	}
}

// A console-only stand goes in one pass: its draft and its saved order are
// deleted at once, then the stand, its variable values with it, and its name
// is free again.
func TestDeleteConsoleStand(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	keep := standInMode("keep", models.ModeDeploy)
	if err := s.prov.CreateStand(ctx, admin(), keep); err != nil {
		t.Fatalf("create stand: %v", err)
	}
	st := standInMode("sandbox", models.ModeConsole)
	if err := s.prov.CreateStand(ctx, admin(), st); err != nil {
		t.Fatalf("create stand: %v", err)
	}
	saved, err := s.prov.Create(ctx, member("core"), newOrder("pg1", placed("pg1", st.ID)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	draft, err := s.prov.Create(ctx, member("core"), newOrder("pg2", onStand(st.ID)))
	if err != nil {
		t.Fatalf("draft: %v", err)
	}
	if err := s.st.UpsertVariable(ctx, &models.Variable{Name: "OPS", Value: "x"}); err != nil {
		t.Fatalf("variable: %v", err)
	}
	if err := s.st.SetVariableOverride(ctx, "OPS", &models.VariableOverride{StandID: st.ID, Value: "y"}); err != nil {
		t.Fatalf("override: %v", err)
	}

	j, err := s.prov.DeleteStand(ctx, admin(), st.ID, "sandbox")
	if err != nil || j.Total != 2 || j.Kind != models.StandJobDelete {
		t.Fatalf("start: %+v %v", j, err)
	}
	if err := s.prov.RunStandJobs(ctx); err != nil {
		t.Fatalf("pass: %v", err)
	}
	got, _ := s.st.GetStandJob(ctx, j.ID)
	if got.Status != models.StandJobDone || got.Done != 2 || len(got.Failures) != 0 {
		t.Fatalf("job: %+v", got)
	}
	for _, id := range []string{saved.ID, draft.ID} {
		if r, _ := s.st.GetRequest(ctx, id); r.DeletedAt == nil {
			t.Fatalf("order %s is deleted", id)
		}
	}
	if _, err := s.prov.GetStand(ctx, st.ID); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("the stand is gone: %v", err)
	}
	list, _ := s.prov.ListStands(ctx)
	if len(list) != 1 || list[0].ID != keep.ID {
		t.Fatalf("listed stands: %+v", list)
	}
	vars, _ := s.st.ListVariables(ctx)
	for _, v := range vars {
		if len(v.Overrides) != 0 {
			t.Fatalf("the stand's variable values go with it: %+v", v.Overrides)
		}
	}
	again := standInMode("sandbox", models.ModeConsole)
	if err := s.prov.CreateStand(ctx, admin(), again); err != nil {
		t.Fatalf("the name is free again: %v", err)
	}
}

// A Git-only stand whose group the portal made: the order goes through a
// delete merge request, no new order is taken meanwhile, and once the order
// is gone the stand and its group go too.
func TestDeleteGitStandRemovesItsGroup(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	s.prov.CreateTeamSubgroup = true
	keep := standInMode("keep", models.ModeDeploy)
	if err := s.prov.CreateStand(ctx, admin(), keep); err != nil {
		t.Fatalf("create stand: %v", err)
	}
	st := standInMode("archive", models.ModeGit)
	if err := s.prov.CreateStand(ctx, admin(), st); err != nil {
		t.Fatalf("create stand: %v", err)
	}
	r, err := s.prov.Create(ctx, member("core"), newOrder("pg1", placed("pg1", st.ID)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if got, _ := s.prov.GetStand(ctx, st.ID); !got.StorageCreated {
		t.Fatalf("the portal made the stand's group and says so: %+v", got)
	}
	s.mergeLatestMR(ctx, t, r.ID)
	s.tick(ctx)

	j, err := s.prov.DeleteStand(ctx, admin(), st.ID, "archive")
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if err := s.prov.RunStandJobs(ctx); err != nil {
		t.Fatalf("pass: %v", err)
	}
	if got := mustStatus(ctx, t, s.st, r.ID); got != models.StatusDeleteRequested {
		t.Fatalf("the order goes through a delete change: %s", got)
	}
	var verr *provisioning.ValidationError
	if _, err := s.prov.Create(ctx, member("core"), newOrder("pg2", placed("pg2", st.ID))); !errors.As(err, &verr) || verr.Message != fmt.Sprintf(provisioning.MsgStandDeleting, "archive") {
		t.Fatalf("an order on a stand being deleted: %v", err)
	}
	s.mergeLatestMR(ctx, t, r.ID)
	s.tick(ctx)
	if err := s.prov.RunStandJobs(ctx); err != nil {
		t.Fatalf("pass: %v", err)
	}
	if got, _ := s.st.GetStandJob(ctx, j.ID); got.Status != models.StandJobDone || got.Done != 1 {
		t.Fatalf("job: %+v", got)
	}
	if _, err := s.gl.GetGroup(ctx, "managed-services/archive"); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("the stand's group is removed: %v", err)
	}
	if _, err := s.gl.GetGroup(ctx, "managed-services"); err != nil {
		t.Fatalf("the configured group stays: %v", err)
	}
}

// A stand on the configured group: its storage is not the portal's to
// remove, even though the stand goes.
func TestDeleteStandKeepsConfiguredGroup(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	keep := standInMode("keep", models.ModeDeploy)
	if err := s.prov.CreateStand(ctx, admin(), keep); err != nil {
		t.Fatalf("create stand: %v", err)
	}
	st := standInMode("shared", models.ModeGit)
	st.GitPath = "managed-services"
	if err := s.prov.CreateStand(ctx, admin(), st); err != nil {
		t.Fatalf("create stand: %v", err)
	}
	if _, err := s.prov.DeleteStand(ctx, admin(), st.ID, "shared"); err != nil {
		t.Fatalf("start: %v", err)
	}
	_ = s.prov.RunStandJobs(ctx)
	if _, err := s.prov.GetStand(ctx, st.ID); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("an empty stand goes in one pass: %v", err)
	}
	if _, err := s.gl.GetGroup(ctx, "managed-services/team-core"); err != nil {
		t.Fatalf("nothing under the configured group is touched: %v", err)
	}
}
