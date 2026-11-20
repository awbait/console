package publications_test

import (
	"context"
	"reflect"
	"testing"

	"console/internal/publications"
	"console/pkg/models"
)

// registryOf is a catalog that answers the registry's version listing with a
// fixed set: enough to say what the registry has and has not.
type registryOf struct {
	forgetful
	versions []string
}

func (r *registryOf) ListVersions(context.Context, string, string) ([]models.ChartVersion, error) {
	out := make([]models.ChartVersion, 0, len(r.versions))
	for _, v := range r.versions {
		out = append(out, models.ChartVersion{Version: v})
	}
	return out, nil
}

func rowOf(t *testing.T, svc *publications.Service, pubID string) publications.RegistryRow {
	t.Helper()
	rows, err := svc.Registry(context.Background())
	if err != nil {
		t.Fatalf("Registry: %v", err)
	}
	for _, r := range rows {
		if r.Publication.ID == pubID {
			return r
		}
	}
	t.Fatalf("publication %s not in the registry", pubID)
	return publications.RegistryRow{}
}

// A publication the registry lists carries what the admin's page shows of it:
// the versions counted by state, what the catalog offers, and what is wrong.
func TestRegistryRowCountsVersionsAndNamesIssues(t *testing.T) {
	ctx := context.Background()
	catalog := &registryOf{versions: []string{"1.0.0", "2.0.0"}}
	svc, p := withCatalog(t, catalog)
	owner := member("core")

	// Freshly registered: no version has a document, so nothing to review or order.
	row := rowOf(t, svc, p.ID)
	if row.Versions.Total != 0 || !reflect.DeepEqual(row.Issues, []string{publications.IssueNoOrderForm}) {
		t.Fatalf("fresh row: versions=%+v issues=%v", row.Versions, row.Issues)
	}
	if row.Versions.Orderable == nil {
		t.Fatal("orderable must be an empty list, not null")
	}

	// 1.0.0 approved and on offer, 2.0.0 a draft with a document.
	for _, v := range []string{"1.0.0", "2.0.0"} {
		if _, err := svc.SaveVersionView(ctx, owner, p.ID, v, viewV1); err != nil {
			t.Fatalf("save %s: %v", v, err)
		}
	}
	if _, err := svc.SubmitVersion(ctx, owner, p.ID, "1.0.0"); err != nil {
		t.Fatalf("submit: %v", err)
	}
	if _, err := svc.ApproveVersion(ctx, admin(), p.ID, "1.0.0"); err != nil {
		t.Fatalf("approve: %v", err)
	}
	if _, err := svc.SetVersionOrderable(ctx, owner, p.ID, "1.0.0", true); err != nil {
		t.Fatalf("orderable: %v", err)
	}
	row = rowOf(t, svc, p.ID)
	want := publications.VersionSummary{Total: 2, Approved: 1, Draft: 1, Orderable: []string{"1.0.0"}, Recommended: "1.0.0"}
	if !reflect.DeepEqual(row.Versions, want) {
		t.Fatalf("versions = %+v, want %+v", row.Versions, want)
	}
	if len(row.Issues) != 0 {
		t.Fatalf("issues = %v, want none", row.Issues)
	}
	if row.Publication.EffectiveStatus != models.PubApproved || row.Publication.RecommendedVersion != "1.0.0" {
		t.Fatalf("publication not filled in: %+v", row.Publication)
	}

	// The registry loses 1.0.0: the approved version is gone, the row says so
	// and offers nothing.
	catalog.versions = []string{"2.0.0"}
	row = rowOf(t, svc, p.ID)
	if row.Versions.Gone != 1 || len(row.Versions.Orderable) != 0 {
		t.Fatalf("after loss: versions=%+v", row.Versions)
	}
	if !reflect.DeepEqual(row.Issues, []string{publications.IssueGone}) {
		t.Fatalf("after loss: issues=%v", row.Issues)
	}

	// The whole chart gone subsumes the gone versions.
	catalog.versions = []string{}
	if row = rowOf(t, svc, p.ID); !reflect.DeepEqual(row.Issues, []string{publications.IssueChartMissing}) {
		t.Fatalf("chart missing: issues=%v", row.Issues)
	}
}

// Approved, on the registry, and still nothing to order: the owner took the
// version off the allowlist. That is its own problem, not a registry one.
func TestRegistryRowApprovedButNotOrderable(t *testing.T) {
	ctx := context.Background()
	svc, p := withCatalog(t, &registryOf{versions: []string{"1.0.0"}})
	owner := member("core")
	if _, err := svc.SaveVersionView(ctx, owner, p.ID, "1.0.0", viewV1); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SubmitVersion(ctx, owner, p.ID, "1.0.0"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ApproveVersion(ctx, admin(), p.ID, "1.0.0"); err != nil {
		t.Fatal(err)
	}
	row := rowOf(t, svc, p.ID)
	if !reflect.DeepEqual(row.Issues, []string{publications.IssueNotOrderable}) {
		t.Fatalf("issues = %v, want not_orderable", row.Issues)
	}
}

// Who asked for a decision comes from the journal, named through the user
// directory, both for the metadata and for a version.
func TestRegistryAndQueueNameTheSubmitter(t *testing.T) {
	ctx := context.Background()
	svc, st := setup(t)
	if err := st.CreateCategory(ctx, &models.Category{ID: "databases", Label: "Базы"}); err != nil {
		t.Fatal(err)
	}
	owner := member("core")
	if err := st.TouchUser(ctx, &models.PlatformUser{Subject: owner.Subject, Name: "Иван Петров", Teams: owner.Teams, Role: owner.Role}); err != nil {
		t.Fatal(err)
	}
	p, err := svc.Create(ctx, owner, publications.CreateInput{
		ChartProject: "platform", ChartName: "ingress-gateway", CategoryID: "network", OwnerTeam: "core",
	})
	if err != nil {
		t.Fatal(err)
	}

	// Nothing under review: no submitter on the row.
	if row := rowOf(t, svc, p.ID); row.Submitted != nil {
		t.Fatalf("submitted = %+v, want nil", row.Submitted)
	}

	to := "databases"
	if _, err := svc.Update(ctx, owner, p.ID, publications.UpdateInput{CategoryID: &to}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Submit(ctx, owner, p.ID); err != nil {
		t.Fatal(err)
	}
	row := rowOf(t, svc, p.ID)
	if row.Submitted == nil || row.Submitted.By != owner.Subject || row.Submitted.ByName != "Иван Петров" || row.Submitted.At.IsZero() {
		t.Fatalf("metadata submitted = %+v", row.Submitted)
	}

	if _, err := svc.SaveVersionView(ctx, owner, p.ID, "3.0.0", viewV1); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SubmitVersion(ctx, owner, p.ID, "3.0.0"); err != nil {
		t.Fatal(err)
	}
	pending, err := svc.PendingVersions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(pending) != 1 || pending[0].Submitted == nil {
		t.Fatalf("pending = %+v", pending)
	}
	if got := pending[0].Submitted; got.By != owner.Subject || got.ByName != "Иван Петров" {
		t.Fatalf("version submitted = %+v", got)
	}
}

// A submitter the directory has never seen is named by subject rather than
// left blank.
func TestSubmitterWithoutDirectoryRecordIsNamedBySubject(t *testing.T) {
	ctx := context.Background()
	svc, _ := setup(t)
	owner := member("core")
	p, err := svc.Create(ctx, owner, publications.CreateInput{
		ChartProject: "platform", ChartName: "ingress-gateway", CategoryID: "network", OwnerTeam: "core",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SaveVersionView(ctx, owner, p.ID, "3.0.0", viewV1); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SubmitVersion(ctx, owner, p.ID, "3.0.0"); err != nil {
		t.Fatal(err)
	}
	pending, err := svc.PendingVersions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(pending) != 1 || pending[0].Submitted == nil || pending[0].Submitted.ByName != owner.Subject {
		t.Fatalf("pending = %+v", pending)
	}
}
