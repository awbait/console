package publications_test

import (
	"context"
	"testing"

	"console/internal/publications"
	"console/internal/store"
	"console/pkg/models"
)

// recorder stands in for the notification domain: it only remembers what it was
// asked to say, which is what these tests are about.
type recorder struct {
	versions []string // "<chart>@<version>" per ChartVersionAvailable
}

func (r *recorder) VersionApproved(context.Context, store.Store, *models.ChartPublication, string, *models.User) {
}
func (r *recorder) VersionRejected(context.Context, store.Store, *models.ChartPublication, string, string, *models.User) {
}
func (r *recorder) ChartVersionAvailable(_ context.Context, _ store.Store, p *models.ChartPublication, v string) {
	r.versions = append(r.versions, p.ChartName+"@"+v)
}

// publish puts a service in the catalog: one approved, orderable version with a
// view, which is what "published" means everywhere else in the portal.
func publish(t *testing.T, st *store.Memory, chart, ownerTeam, version string) *models.ChartPublication {
	t.Helper()
	ctx := context.Background()
	p := &models.ChartPublication{
		ID: chart + "-id", ChartProject: "platform", ChartName: chart,
		CategoryID: "network", OwnerTeam: ownerTeam, Status: models.PubApproved,
	}
	if err := st.CreatePublication(ctx, p); err != nil {
		t.Fatal(err)
	}
	if version == "" {
		return p
	}
	v := &models.PublicationVersion{
		ID: chart + "-" + version, PublicationID: p.ID, ChartVersion: version,
		Status: models.PubApproved, Orderable: true, ApprovedViewJSON: viewV1,
	}
	if err := st.UpsertVersion(ctx, v); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestNotifyNewVersions(t *testing.T) {
	ctx := context.Background()
	svc, st := setup(t)
	rec := &recorder{}
	svc.SetNotifier(rec)

	publish(t, st, "ingress-gateway", "core", "1.2.0")     // has a newer release
	publish(t, st, "policies", "core", "3.0.0")            // already on the newest
	publish(t, st, "namespace", "core", "")                // nothing published yet
	publish(t, st, "waypoint", "platform-admins", "1.0.0") // unclaimed

	svc.SetDiscoveryOwner("platform-admins")

	refs := []publications.ChartVersionRef{
		{Project: "platform", Name: "ingress-gateway", LatestVersion: "1.3.0"},
		{Project: "platform", Name: "policies", LatestVersion: "3.0.0"},
		{Project: "platform", Name: "namespace", LatestVersion: "2.0.0"},
		{Project: "platform", Name: "waypoint", LatestVersion: "1.1.0"},
		{Project: "platform", Name: "not-registered", LatestVersion: "9.9.9"},
	}
	if err := svc.NotifyNewVersions(ctx, refs); err != nil {
		t.Fatalf("notify: %v", err)
	}

	// Only the one whose owners have something to do about it.
	if len(rec.versions) != 1 || rec.versions[0] != "ingress-gateway@1.3.0" {
		t.Fatalf("got %v", rec.versions)
	}
}

// A service whose newest published version is higher than the registry's is not
// news: that is what an owner sees while a newer release is being withdrawn.
func TestNotifyNewVersionsIgnoresOlderReleases(t *testing.T) {
	ctx := context.Background()
	svc, st := setup(t)
	rec := &recorder{}
	svc.SetNotifier(rec)
	publish(t, st, "ingress-gateway", "core", "2.0.0")

	err := svc.NotifyNewVersions(ctx, []publications.ChartVersionRef{
		{Project: "platform", Name: "ingress-gateway", LatestVersion: "1.9.9"},
	})
	if err != nil {
		t.Fatalf("notify: %v", err)
	}
	if len(rec.versions) != 0 {
		t.Fatalf("want silence, got %v", rec.versions)
	}
}
