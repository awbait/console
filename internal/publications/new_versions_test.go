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
	versions   []string // "<chart>@<version>" per ChartVersionAvailable
	submitted  []string // "<chart>@<version>" per VersionSubmitted
	discovered []string // "<project>/<chart>" per ChartDiscovered
	missing    []string // "<chart>@<version>" per ChartVersionMissing
}

func (r *recorder) VersionApproved(context.Context, store.Store, *models.ChartPublication, string, *models.User) {
}
func (r *recorder) VersionRejected(context.Context, store.Store, *models.ChartPublication, string, string, *models.User) {
}
func (r *recorder) ChartVersionAvailable(_ context.Context, _ store.Store, p *models.ChartPublication, v string) {
	r.versions = append(r.versions, p.ChartName+"@"+v)
}
func (r *recorder) VersionSubmitted(_ context.Context, _ store.Store, p *models.ChartPublication, v string, _ *models.User) {
	r.submitted = append(r.submitted, p.ChartName+"@"+v)
}
func (r *recorder) ChartDiscovered(_ context.Context, _ store.Store, p *models.ChartPublication) {
	r.discovered = append(r.discovered, p.ChartProject+"/"+p.ChartName)
}
func (r *recorder) ChartVersionMissing(_ context.Context, _ store.Store, p *models.ChartPublication, v string) {
	r.missing = append(r.missing, p.ChartName+"@"+v)
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

// The approval queue is work for the platform team, and until now they learned
// of it only by opening the page. Same for a chart the portal finds itself: an
// unadopted draft is invisible in the catalog, so a find nobody hears about is
// a find that changes nothing.
func TestAdminsHearAboutTheirQueue(t *testing.T) {
	ctx := context.Background()
	svc, _ := setup(t)
	rec := &recorder{}
	svc.SetNotifier(rec)
	svc.SetDiscoveryOwner("platform-admins")

	if err := svc.EnsureDiscovered(ctx,
		[]publications.DiscoveredChart{{Project: "platform", Name: "waypoint", Author: "core"}},
		"platform-admins", "network"); err != nil {
		t.Fatalf("discover: %v", err)
	}
	if len(rec.discovered) != 1 || rec.discovered[0] != "platform/waypoint" {
		t.Fatalf("discovered = %v", rec.discovered)
	}

	// A chart already registered is not a find: the sweep runs every tick.
	if err := svc.EnsureDiscovered(ctx,
		[]publications.DiscoveredChart{{Project: "platform", Name: "waypoint"}},
		"platform-admins", "network"); err != nil {
		t.Fatalf("discover again: %v", err)
	}
	if len(rec.discovered) != 1 {
		t.Fatalf("a second sweep said it again: %v", rec.discovered)
	}
}

// A version deleted from the registry does not break the service that runs on
// it, but nothing can be ordered from it any more, and in the catalog the
// service falls in with the ones nobody ever published. Its owners have to hear
// about it.
func TestNotifyMissingVersions(t *testing.T) {
	ctx := context.Background()
	svc, st := setup(t)
	rec := &recorder{}
	svc.SetNotifier(rec)
	publish(t, st, "ingress-gateway", "core", "1.2.0")

	// The registry has other versions, but not the published one.
	err := svc.NotifyNewVersions(ctx, []publications.ChartVersionRef{
		{Project: "platform", Name: "ingress-gateway", LatestVersion: "1.3.0", Versions: []string{"1.3.0"}},
	})
	if err != nil {
		t.Fatalf("notify: %v", err)
	}
	if len(rec.missing) != 1 || rec.missing[0] != "ingress-gateway@1.2.0" {
		t.Fatalf("missing = %v", rec.missing)
	}
}

// An empty answer from the registry is an outage far more often than every
// version being deleted at once. Announcing the second would mean a false alarm
// on every hiccup.
func TestSilentWhenTheRegistrySaysNothing(t *testing.T) {
	ctx := context.Background()
	svc, st := setup(t)
	rec := &recorder{}
	svc.SetNotifier(rec)
	publish(t, st, "ingress-gateway", "core", "1.2.0")

	for _, versions := range [][]string{nil, {}} {
		err := svc.NotifyNewVersions(ctx, []publications.ChartVersionRef{
			{Project: "platform", Name: "ingress-gateway", Versions: versions},
		})
		if err != nil {
			t.Fatalf("notify: %v", err)
		}
	}
	if len(rec.missing) != 0 {
		t.Fatalf("want silence, got %v", rec.missing)
	}
}

// A version still in the registry is not news, however often the sweep runs.
func TestNoAlarmWhileTheVersionIsThere(t *testing.T) {
	ctx := context.Background()
	svc, st := setup(t)
	rec := &recorder{}
	svc.SetNotifier(rec)
	publish(t, st, "ingress-gateway", "core", "1.2.0")

	err := svc.NotifyNewVersions(ctx, []publications.ChartVersionRef{
		{Project: "platform", Name: "ingress-gateway", LatestVersion: "1.2.0", Versions: []string{"1.2.0"}},
	})
	if err != nil {
		t.Fatalf("notify: %v", err)
	}
	if len(rec.missing) != 0 || len(rec.versions) != 0 {
		t.Fatalf("missing=%v available=%v", rec.missing, rec.versions)
	}
}
