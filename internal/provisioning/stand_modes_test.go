package provisioning_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"console/internal/provisioning"
	"console/pkg/models"
)

func standInMode(name, mode string) *models.Stand {
	return &models.Stand{Name: name, DefaultCluster: "in-cluster", Layout: models.LayoutGroup, GitPath: "managed-services/" + name, Mode: mode}
}

func placed(serviceName, standID string) func(*provisioning.CreateInput) {
	return func(in *provisioning.CreateInput) {
		in.StandID = standID
		in.Draft = false
		in.Values = validValues()
	}
}

func eventTypes(ctx context.Context, t *testing.T, s *stack, id string) []string {
	t.Helper()
	evs, err := s.st.ListEvents(ctx, id)
	if err != nil {
		t.Fatalf("events: %v", err)
	}
	out := make([]string, 0, len(evs))
	for _, e := range evs {
		if e.EventType == "status_changed" {
			out = append(out, "status:"+string(e.ToStatus))
		} else {
			out = append(out, e.EventType)
		}
	}
	return out
}

// A stand that keeps its orders in the portal: placing an order saves it and
// that is the whole lifecycle. Nothing reaches GitLab, edits land in place
// with a row in the history, Git and Argo CD actions are refused, and
// deletion is immediate.
func TestConsoleStandKeepsOrdersInPortal(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	st := standInMode("sandbox", models.ModeConsole)
	if err := s.prov.CreateStand(ctx, admin(), st); err != nil {
		t.Fatalf("create stand: %v", err)
	}
	r, err := s.prov.Create(ctx, member("core"), newOrder("pg1", placed("pg1", st.ID)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if r.Status != models.StatusConsoleSaved {
		t.Fatalf("status after placing: %s", r.Status)
	}
	if _, err := s.gl.GetProject(ctx, "managed-services/sandbox/team-core/postgres"); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("nothing is written to GitLab for a console stand: %v", err)
	}
	if mrs, _ := s.st.ListMRs(ctx, r.ID); len(mrs) != 0 {
		t.Fatalf("no merge request for a console stand: %+v", mrs)
	}

	// An edit: checked like a live edit, written in place, no merge request.
	upd, err := s.prov.Update(ctx, member("core"), r.ID, provisioning.UpdateInput{
		Values: map[string]any{"auth": map[string]any{"database": "other"}},
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if upd.Status != models.StatusConsoleSaved || !strings.Contains(upd.ValuesYAML, "other") {
		t.Fatalf("update in place: status=%s values=%q", upd.Status, upd.ValuesYAML)
	}
	got := eventTypes(ctx, t, s, r.ID)
	if got[len(got)-1] != "updated" || got[1] != "status:CONSOLE_SAVED" {
		t.Fatalf("history of a console order: %v", got)
	}
	// Nothing changed: no row for that.
	if _, err := s.prov.Update(ctx, member("core"), r.ID, provisioning.UpdateInput{
		Values: map[string]any{"auth": map[string]any{"database": "other"}},
	}); err != nil {
		t.Fatalf("update without a change: %v", err)
	}
	if again := eventTypes(ctx, t, s, r.ID); len(again) != len(got) {
		t.Fatalf("an unchanged edit writes no history: %v", again)
	}

	var verr *provisioning.ValidationError
	if _, err := s.prov.PullFromGit(ctx, member("core"), r.ID); !errors.As(err, &verr) || verr.Message != provisioning.MsgPullMode {
		t.Fatalf("pull on a console stand: %v", err)
	}
	if err := s.prov.ForceSync(ctx, admin(), r.ID); !errors.As(err, &verr) || verr.Message != provisioning.MsgSyncMode {
		t.Fatalf("sync on a console stand: %v", err)
	}

	// A draft is still a draft on such a stand, and submitting it saves it.
	d, err := s.prov.Create(ctx, member("core"), newOrder("pg2", onStand(st.ID)))
	if err != nil || d.Status != models.StatusDraft {
		t.Fatalf("draft: %v %s", err, d.Status)
	}
	if _, err := s.prov.Update(ctx, member("core"), d.ID, provisioning.UpdateInput{Values: validValues()}); err != nil {
		t.Fatalf("fill the draft: %v", err)
	}
	sub, err := s.prov.Submit(ctx, member("core"), d.ID)
	if err != nil || sub.Status != models.StatusConsoleSaved {
		t.Fatalf("submit: %v %s", err, sub.Status)
	}

	del, err := s.prov.Delete(ctx, member("core"), r.ID)
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	if del.Status != models.StatusDeleted || del.DeletedAt == nil {
		t.Fatalf("a console order leaves at once: %s %v", del.Status, del.DeletedAt)
	}
	// The stand had live orders, so its mode was locked; now it is not.
	locked, _ := s.prov.GetStand(ctx, st.ID)
	if !locked.Locked {
		t.Fatalf("a stand with a saved order is locked")
	}
}

// A stand that only keeps files in Git: the merge request is opened and
// merged as always, and after the merge the order rests in GIT_SAVED instead
// of waiting for Argo CD. Edits and deletion go through merge requests too,
// and a merged deletion is the deletion.
func TestGitStandStopsAtGitSaved(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	st := standInMode("archive", models.ModeGit)
	st.GitPath = "managed-services" // the configured group: no subgroup creation needed
	if err := s.prov.CreateStand(ctx, admin(), st); err != nil {
		t.Fatalf("create stand: %v", err)
	}
	r, err := s.prov.Create(ctx, member("core"), newOrder("pg1", placed("pg1", st.ID)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if r.Status != models.StatusMRCreated {
		t.Fatalf("status after placing: %s", r.Status)
	}
	s.mergeLatestMR(ctx, t, r.ID)
	s.tick(ctx)
	if got := mustStatus(ctx, t, s.st, r.ID); got != models.StatusGitSaved {
		t.Fatalf("after the merge: %s", got)
	}
	// Another tick changes nothing: there is no Argo CD to follow.
	s.tick(ctx)
	if got := mustStatus(ctx, t, s.st, r.ID); got != models.StatusGitSaved {
		t.Fatalf("resting: %s", got)
	}

	upd, err := s.prov.Update(ctx, member("core"), r.ID, provisioning.UpdateInput{
		Values: map[string]any{"auth": map[string]any{"database": "other"}},
	})
	if err != nil || upd.Status != models.StatusMRCreated {
		t.Fatalf("edit opens a merge request: %v %s", err, upd.Status)
	}
	s.mergeLatestMR(ctx, t, r.ID)
	s.tick(ctx)
	if got := mustStatus(ctx, t, s.st, r.ID); got != models.StatusGitSaved {
		t.Fatalf("after the edit merged: %s", got)
	}
	var verr *provisioning.ValidationError
	if err := s.prov.ForceSync(ctx, admin(), r.ID); !errors.As(err, &verr) || verr.Message != provisioning.MsgSyncMode {
		t.Fatalf("sync on a git stand: %v", err)
	}

	del, err := s.prov.Delete(ctx, member("core"), r.ID)
	if err != nil || del.Status != models.StatusDeleteRequested {
		t.Fatalf("delete opens a merge request: %v %s", err, del.Status)
	}
	s.mergeLatestMR(ctx, t, r.ID)
	s.tick(ctx)
	if got := mustStatus(ctx, t, s.st, r.ID); got != models.StatusDeleted {
		t.Fatalf("a merged deletion is the deletion: %s", got)
	}
}

// The chart source of an application follows the stand's registry when the
// stand names one, and the platform's otherwise; the stand's manifests then
// carry the credential for it.
func TestChartRegistryPerStand(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	s.prov.GitLabURL = "https://gitlab.example.com"
	st := standInMode("edge", models.ModeDeploy)
	st.ChartRegistry = "registry.example.com:5000/mirror"
	if err := s.prov.CreateStand(ctx, admin(), st); err != nil {
		t.Fatalf("create stand: %v", err)
	}
	r := &models.Request{Team: "core", ChartProject: "platform", ChartName: "postgres", ChartVersion: "1.0.0",
		ServiceName: "pg1", Namespace: "pg1", Cluster: "in-cluster", ArgoCDAppName: "core-postgres-pg1-pg1", InstancePath: "in-cluster/pg1/pg1"}
	own, err := s.gitops.RenderApplication(r, "https://gitlab.example.com/x", st.ChartRegistry)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if !strings.Contains(own, "repoURL: registry.example.com:5000/mirror/platform") {
		t.Fatalf("the stand's registry in the chart source:\n%s", own)
	}
	shared, _ := s.gitops.RenderApplication(r, "https://gitlab.example.com/x", "")
	if strings.Contains(shared, "registry.example.com") {
		t.Fatalf("an empty registry is the platform's:\n%s", shared)
	}
	out, err := s.prov.StandManifests(st)
	if err != nil {
		t.Fatalf("manifests: %v", err)
	}
	if !strings.Contains(out, "url: registry.example.com:5000/mirror") || !strings.Contains(out, `enableOCI: "true"`) {
		t.Fatalf("manifests carry the registry credential:\n%s", out)
	}
	plain := standInMode("plain", models.ModeDeploy)
	if err := s.prov.CreateStand(ctx, admin(), plain); err != nil {
		t.Fatalf("create stand: %v", err)
	}
	if out, _ := s.prov.StandManifests(plain); strings.Contains(out, "enableOCI") {
		t.Fatalf("no registry, no credential:\n%s", out)
	}
}

// What an admin may type for a stand's mode and registry, and when the mode
// may change: not while the stand has orders beyond drafts and deleted ones.
func TestStandModeIsChecked(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	var verr *provisioning.ValidationError
	bad := standInMode("a", "sometimes")
	if err := s.prov.CreateStand(ctx, admin(), bad); !errors.As(err, &verr) || verr.Message != provisioning.MsgStandMode {
		t.Fatalf("an unknown mode: %v", err)
	}
	badReg := standInMode("b", models.ModeDeploy)
	badReg.ChartRegistry = "https://registry.example.com"
	if err := s.prov.CreateStand(ctx, admin(), badReg); !errors.As(err, &verr) || verr.Message != provisioning.MsgStandRegistry {
		t.Fatalf("a registry with a scheme: %v", err)
	}
	ok := standInMode("c", "")
	ok.ChartRegistry = " registry.example.com/ "
	if err := s.prov.CreateStand(ctx, admin(), ok); err != nil {
		t.Fatalf("an empty mode is deploy and the registry is trimmed: %v", err)
	}
	if ok.Mode != models.ModeDeploy || ok.ChartRegistry != "registry.example.com" {
		t.Fatalf("stored as %q %q", ok.Mode, ok.ChartRegistry)
	}

	// Switching modes is fine while nothing is placed, and refused after.
	toGit := *ok
	toGit.Mode = models.ModeGit
	if err := s.prov.UpdateStand(ctx, admin(), &toGit); err != nil {
		t.Fatalf("switch an empty stand: %v", err)
	}
	toConsole := toGit
	toConsole.Mode = models.ModeConsole
	if err := s.prov.UpdateStand(ctx, admin(), &toConsole); err != nil {
		t.Fatalf("switch again: %v", err)
	}
	if _, err := s.prov.Create(ctx, member("core"), newOrder("pg1", placed("pg1", ok.ID))); err != nil {
		t.Fatalf("create: %v", err)
	}
	// The registry is not locked: it only shapes what is rendered next.
	reg := toConsole
	reg.ChartRegistry = "other.example.com"
	if err := s.prov.UpdateStand(ctx, admin(), &reg); err != nil {
		t.Fatalf("changing the registry of a stand with an order: %v", err)
	}
	if _, err := s.prov.StandManifests(&reg); !errors.As(err, &verr) || verr.Message != provisioning.MsgManifestsMode {
		t.Fatalf("manifests of a console stand: %v", err)
	}
	// With an order on it, leaving console-only starts a job that moves it.
	back := reg
	back.Mode = models.ModeDeploy
	if err := s.prov.UpdateStand(ctx, admin(), &back); err != nil || back.Job == nil {
		t.Fatalf("switching a stand with an order starts a job: %v %+v", err, back.Job)
	}
	// And a deploying stand with an order cannot leave deploy.
	d := standInMode("d", models.ModeDeploy)
	d.GitPath = "managed-services"
	if err := s.prov.CreateStand(ctx, admin(), d); err != nil {
		t.Fatalf("create stand: %v", err)
	}
	if _, err := s.prov.Create(ctx, member("core"), newOrder("pg9", placed("pg9", d.ID))); err != nil {
		t.Fatalf("create: %v", err)
	}
	leave := *d
	leave.Mode = models.ModeGit
	if err := s.prov.UpdateStand(ctx, admin(), &leave); !errors.As(err, &verr) || verr.Message != provisioning.MsgStandDeployLeave {
		t.Fatalf("leaving deploy with an order: %v", err)
	}
}

// A stand whose Argo CD sees GitLab under another address and runs in another
// namespace: the order's application points there, at the same repository
// path, and so do the stand's manifests. A stand naming neither keeps the
// portal's own.
func TestStandGitURLAndArgoNamespace(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	s.prov.GitLabURL = "https://gitlab.idp.example.com"
	st := standInMode("edp", models.ModeDeploy)
	st.GitPath = "managed-services"
	st.GitURL = " https://gitlab.edp.example.com/ "
	st.ArgoNamespace = "ecpk-argocd"
	if err := s.prov.CreateStand(ctx, admin(), st); err != nil {
		t.Fatalf("create stand: %v", err)
	}
	if st.GitURL != "https://gitlab.edp.example.com" {
		t.Fatalf("the address is trimmed: %q", st.GitURL)
	}
	r, err := s.prov.Create(ctx, member("core"), newOrder("pg1", placed("pg1", st.ID)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	mrs, _ := s.st.ListMRs(ctx, r.ID)
	proj, err := s.gl.GetProject(ctx, "managed-services/team-core/postgres")
	if err != nil || len(mrs) != 1 {
		t.Fatalf("repo and change: %v %d", err, len(mrs))
	}
	s.mergeLatestMR(ctx, t, r.ID)
	app, err := s.gl.GetFile(ctx, proj.ID, s.gitops.AppPath(r), "main")
	if err != nil {
		t.Fatalf("application.yaml: %v", err)
	}
	for _, want := range []string{
		"repoURL: https://gitlab.edp.example.com/managed-services/team-core/postgres.git",
		"namespace: ecpk-argocd",
	} {
		if !strings.Contains(string(app), want) {
			t.Fatalf("application lacks %q:\n%s", want, app)
		}
	}
	out, err := s.prov.StandManifests(st)
	if err != nil {
		t.Fatalf("manifests: %v", err)
	}
	for _, want := range []string{"api: https://gitlab.edp.example.com", "url: https://gitlab.edp.example.com/managed-services", "namespace: ecpk-argocd"} {
		if !strings.Contains(out, want) {
			t.Fatalf("manifests lack %q:\n%s", want, out)
		}
	}

	var verr *provisioning.ValidationError
	bad := standInMode("bad1", models.ModeDeploy)
	bad.GitURL = "gitlab.edp.example.com"
	if err := s.prov.CreateStand(ctx, admin(), bad); !errors.As(err, &verr) || verr.Message != provisioning.MsgStandGitURL {
		t.Fatalf("an address without a scheme: %v", err)
	}
	bad = standInMode("bad2", models.ModeDeploy)
	bad.ArgoNamespace = "Ecpk_ArgoCD"
	if err := s.prov.CreateStand(ctx, admin(), bad); !errors.As(err, &verr) || verr.Message != provisioning.MsgStandArgoNs {
		t.Fatalf("a namespace in the wrong shape: %v", err)
	}
}
