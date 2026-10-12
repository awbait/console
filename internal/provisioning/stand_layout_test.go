package provisioning_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"console/internal/provisioning"
	"console/internal/store"
	"console/pkg/models"
)

func standWith(name, cluster, layout, path string) *models.Stand {
	return &models.Stand{Name: name, DefaultCluster: cluster, Layout: layout, GitPath: path}
}

// A stand laid out as one repository puts every order in it, under the team
// and the chart, and makes the repository on the first order. The application
// is rendered against that repository, and the order can be deleted from it.
func TestRepositoryLayoutWritesOneRepo(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	st := standWith("stage", "stage-a", models.LayoutRepository, "managed-services/stage-gitops")
	if err := s.prov.CreateStand(ctx, admin(), st); err != nil {
		t.Fatalf("create stand: %v", err)
	}
	r, err := s.prov.Create(ctx, member("core"), newOrder("pg1", onStand(st.ID), func(in *provisioning.CreateInput) {
		in.Draft = false
		in.Values = validValues()
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if r.InstancePath != "team-core/postgres/stage-a/pg1/pg1" {
		t.Fatalf("instance path under the repository layout: %q", r.InstancePath)
	}
	proj, err := s.gl.GetProject(ctx, "managed-services/stage-gitops")
	if err != nil {
		t.Fatalf("the stand's repository is made on the first order: %v", err)
	}
	s.mergeLatestMR(ctx, t, r.ID)
	files, err := s.gl.ListTree(ctx, proj.ID, "main", "team-core/postgres")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	var app, values bool
	for _, f := range files {
		app = app || f == "team-core/postgres/stage-a/pg1/pg1/application.yaml"
		values = values || f == "team-core/postgres/stage-a/pg1/pg1/values.yaml"
	}
	if !app || !values {
		t.Fatalf("files in the stand repository: %v", files)
	}
	if _, err := s.gl.GetProject(ctx, "managed-services/team-core/postgres"); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("nothing is written to the group layout for this stand: %v", err)
	}

	// The stand is now locked: its layout and path cannot move.
	got, err := s.prov.GetStand(ctx, st.ID)
	if err != nil || !got.Locked {
		t.Fatalf("a stand with an order is locked: %+v (%v)", got, err)
	}
	moved := *got
	moved.GitPath = "managed-services/elsewhere"
	err = s.prov.UpdateStand(ctx, admin(), &moved)
	var verr *provisioning.ValidationError
	if !errors.As(err, &verr) || !strings.Contains(verr.Message, "заказы") {
		t.Fatalf("moving a locked stand: want a validation error, got %v", err)
	}
	renamed := *got
	renamed.Name = "stage-2"
	if err := s.prov.UpdateStand(ctx, admin(), &renamed); err != nil {
		t.Fatalf("renaming a locked stand is fine: %v", err)
	}
}

// A stand laid out as a group under a path of its own gets that group made
// under its parent, then the team subgroup and the chart repository in it, the
// way the configured group always worked.
func TestGroupLayoutUnderOwnPath(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	s.prov.CreateTeamSubgroup = true
	st := standWith("prod", "prod-a", models.LayoutGroup, "managed-services/prod")
	if err := s.prov.CreateStand(ctx, admin(), st); err != nil {
		t.Fatalf("create stand: %v", err)
	}
	r, err := s.prov.Create(ctx, member("core"), newOrder("pg1", onStand(st.ID), func(in *provisioning.CreateInput) {
		in.Draft = false
		in.Values = validValues()
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if r.InstancePath != "prod-a/pg1/pg1" {
		t.Fatalf("instance path under the group layout: %q", r.InstancePath)
	}
	if _, err := s.gl.GetGroup(ctx, "managed-services/prod/team-core"); err != nil {
		t.Fatalf("the team subgroup is made under the stand's group: %v", err)
	}
	if _, err := s.gl.GetProject(ctx, "managed-services/prod/team-core/postgres"); err != nil {
		t.Fatalf("the chart repository is made in it: %v", err)
	}

	// A path whose parent is not there is refused, not invented.
	orphan := standWith("edge", "edge", models.LayoutGroup, "nowhere/edge")
	if err := s.prov.CreateStand(ctx, admin(), orphan); err != nil {
		t.Fatalf("create stand: %v", err)
	}
	_, err = s.prov.Create(ctx, member("core"), newOrder("pg2", onStand(orphan.ID), func(in *provisioning.CreateInput) {
		in.Draft = false
		in.Values = validValues()
	}))
	if !errors.Is(err, provisioning.ErrNotConfigured) {
		t.Fatalf("a missing parent group: want ErrNotConfigured, got %v", err)
	}
}

// What an admin may type for a stand's layout and path.
func TestStandLayoutIsChecked(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	for _, bad := range []*models.Stand{
		standWith("a", "in-cluster", "folder", "managed-services/a"),
		standWith("b", "in-cluster", models.LayoutGroup, ""),
		standWith("c", "in-cluster", models.LayoutGroup, "bad path/with space"),
		standWith("d", "in-cluster", models.LayoutRepository, "../up"),
	} {
		err := s.prov.CreateStand(ctx, admin(), bad)
		var verr *provisioning.ValidationError
		if !errors.As(err, &verr) {
			t.Errorf("stand %q: want ValidationError, got %v", bad.Name, err)
		}
	}
	ok := &models.Stand{Name: "e", DefaultCluster: "in-cluster", GitPath: "/managed-services/e/"}
	if err := s.prov.CreateStand(ctx, admin(), ok); err != nil {
		t.Fatalf("an empty layout is the group layout and the path is trimmed: %v", err)
	}
	if ok.Layout != models.LayoutGroup || ok.GitPath != "managed-services/e" {
		t.Fatalf("stored as %q %q", ok.Layout, ok.GitPath)
	}
}

// A stand made before paths existed has none. Renaming it does not wait for
// the path, a path once set cannot be cleared, and an order on the pathless
// stand is refused with a message naming the stand, while a draft is fine.
func TestStandWithoutPath(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	legacy := &models.Stand{ID: "legacy", Name: "old", DefaultCluster: "in-cluster", Layout: models.LayoutGroup}
	if err := s.st.CreateStand(ctx, legacy); err != nil {
		t.Fatalf("seed a pathless stand: %v", err)
	}
	renamed := *legacy
	renamed.Name = "older"
	if err := s.prov.UpdateStand(ctx, admin(), &renamed); err != nil {
		t.Fatalf("rename without a path: %v", err)
	}
	withPath := renamed
	withPath.GitPath = "managed-services/old"
	if err := s.prov.UpdateStand(ctx, admin(), &withPath); err != nil {
		t.Fatalf("set the path: %v", err)
	}
	cleared := withPath
	cleared.GitPath = ""
	var verr *provisioning.ValidationError
	if err := s.prov.UpdateStand(ctx, admin(), &cleared); !errors.As(err, &verr) || verr.Message != provisioning.MsgStandPathClear {
		t.Fatalf("clearing a set path: want %q, got %v", provisioning.MsgStandPathClear, err)
	}

	pathless := &models.Stand{ID: "pathless", Name: "sandbox", DefaultCluster: "in-cluster", Layout: models.LayoutGroup}
	if err := s.st.CreateStand(ctx, pathless); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if _, err := s.prov.Create(ctx, member("core"), newOrder("pg1", onStand(pathless.ID))); err != nil {
		t.Fatalf("a draft on a pathless stand: %v", err)
	}
	_, err := s.prov.Create(ctx, member("core"), newOrder("pg2", onStand(pathless.ID), func(in *provisioning.CreateInput) {
		in.Draft = false
		in.Values = validValues()
	}))
	want := fmt.Sprintf(provisioning.MsgStandNoPath, "sandbox")
	if !errors.As(err, &verr) || verr.Message != want {
		t.Fatalf("an order on a pathless stand: want %q, got %v", want, err)
	}
}

// The manifests a stand page offers: the stand's own path, GitLab and Argo CD
// namespace, by layout.
func TestStandManifests(t *testing.T) {
	s := newStack(t)
	s.prov.GitLabURL = "https://gitlab.example.com/"
	s.prov.ArgoCDNamespace = "argocd"

	group := standWith("Stage 1", "stage", models.LayoutGroup, "managed-services/stage")
	out, err := s.prov.StandManifests(group)
	if err != nil {
		t.Fatalf("group manifests: %v", err)
	}
	for _, want := range []string{
		"kind: ApplicationSet", "name: portal-stand-stage-1", `group: "managed-services/stage"`,
		"api: https://gitlab.example.com", "url: https://gitlab.example.com/managed-services/stage",
		"project: portal-managed", "namespace: argocd", "secret-type: repo-creds",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("group manifests lack %q:\n%s", want, out)
		}
	}
	repo := standWith("prod", "prod-a", models.LayoutRepository, "ops/prod-gitops")
	out, err = s.prov.StandManifests(repo)
	if err != nil {
		t.Fatalf("repo manifests: %v", err)
	}
	for _, want := range []string{
		"kind: Application\n", "name: portal-stand-prod", "repoURL: https://gitlab.example.com/ops/prod-gitops.git",
		"targetRevision: main", `include: "**/application.yaml"`, "secret-type: repository",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("repo manifests lack %q:\n%s", want, out)
		}
	}
	if strings.Contains(out, "ApplicationSet") {
		t.Fatalf("one repository needs no generator:\n%s", out)
	}
	if _, err := s.prov.StandManifests(&models.Stand{Name: "x"}); err == nil {
		t.Fatal("a stand without a path has nothing to wire")
	}
}

// Import walks each stand's own path and adopts what it finds onto that
// stand, reading the team and the chart from the folders under the
// repository layout. The stage repository sits inside dev's group here, as a
// nested path would in a real GitLab: the more specific path claims it, and
// dev's walk leaves it alone.
func TestImportWalksEachStand(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	dev := standWith("dev", "in-cluster", models.LayoutGroup, "managed-services")
	if err := s.prov.CreateStand(ctx, admin(), dev); err != nil {
		t.Fatalf("create dev: %v", err)
	}
	stage := standWith("stage", "stage-a", models.LayoutRepository, "managed-services/stage-gitops")
	if err := s.prov.CreateStand(ctx, admin(), stage); err != nil {
		t.Fatalf("create stage: %v", err)
	}
	// One order on each, written by the portal, then forgotten by it.
	for _, st := range []*models.Stand{dev, stage} {
		r, err := s.prov.Create(ctx, member("core"), newOrder("pg-"+st.Name, onStand(st.ID), func(in *provisioning.CreateInput) {
			in.Draft = false
			in.Values = validValues()
		}))
		if err != nil {
			t.Fatalf("create on %s: %v", st.Name, err)
		}
		s.mergeLatestMR(ctx, t, r.ID)
		// A deleted row no longer claims its application, so the manifest
		// still in Git is a new instance to the import.
		now := time.Now()
		r.Status, r.DeletedAt = models.StatusDeleted, &now
		if err := s.st.UpdateRequest(ctx, r); err != nil {
			t.Fatalf("forget: %v", err)
		}
	}
	if err := s.prov.ImportFromGit(ctx); err != nil {
		t.Fatalf("import: %v", err)
	}
	list, _ := s.prov.List(ctx, admin(), store.RequestFilter{})
	byName := map[string]*models.Request{}
	for _, r := range list {
		byName[r.ServiceName] = r
	}
	onDev, onStage := byName["pg-dev"], byName["pg-stage"]
	if onDev == nil || onStage == nil {
		t.Fatalf("both orders are found again: %v", byName)
	}
	if onDev.StandID != dev.ID || onStage.StandID != stage.ID {
		t.Fatalf("adopted onto the stand whose path they were under: dev=%s stage=%s", onDev.StandID, onStage.StandID)
	}
	if onStage.Team != "core" || onStage.ChartName != "postgres" || onStage.InstancePath != "team-core/postgres/stage-a/pg-stage/pg-stage" {
		t.Fatalf("repository layout read from the folders: %+v", onStage)
	}
}
