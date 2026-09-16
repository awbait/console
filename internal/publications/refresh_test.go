package publications_test

import (
	"context"
	"errors"
	"testing"

	"console/internal/publications"
	"console/internal/store"
	"console/pkg/models"
)

// forgetful stands in for the catalog: it records what it was asked to forget
// and answers with a version count.
type forgetful struct {
	forgot   []string
	versions int
	err      error
}

func (f *forgetful) LatestDescription(context.Context, string, string) (string, error) {
	return "", nil
}
func (f *forgetful) LatestIcon(context.Context, string, string) (string, error) { return "", nil }
func (f *forgetful) GetSchema(context.Context, string, string, string) ([]byte, error) {
	return nil, nil
}
func (f *forgetful) FormSchema(context.Context, string, string, string) ([]byte, []models.ChartDependency, error) {
	return nil, nil, nil
}
func (f *forgetful) ListVersions(context.Context, string, string) ([]models.ChartVersion, error) {
	return nil, nil
}
func (f *forgetful) Forget(_ context.Context, project, name string) (int, error) {
	if f.err != nil {
		return 0, f.err
	}
	f.forgot = append(f.forgot, project+"/"+name)
	return f.versions, nil
}

// withCatalog is setup() with a catalog behind the service, and a publication
// for the team "core" already in it.
func withCatalog(t *testing.T, catalog publications.SchemaSource) (*publications.Service, *models.ChartPublication) {
	t.Helper()
	st := store.NewMemory()
	if err := st.CreateCategory(context.Background(), &models.Category{ID: "network", Label: "Сеть"}); err != nil {
		t.Fatal(err)
	}
	svc := publications.New(st, catalog)
	p, err := svc.Create(context.Background(), member("core"), publications.CreateInput{
		ChartProject: "platform", ChartName: "egress-gateway",
		CategoryID: "network", OwnerTeam: "core",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	return svc, p
}

// The team that owns the publication is the team that pushes the chart, so
// re-reading it is theirs to ask for: otherwise they need somebody with access
// to the portal's cache to do it for them.
func TestOwnerCanHaveTheChartReRead(t *testing.T) {
	ctx := context.Background()
	catalog := &forgetful{versions: 3}
	svc, p := withCatalog(t, catalog)
	owner := member("core")

	versions, err := svc.RefreshChart(ctx, owner, p.ID)
	if err != nil {
		t.Fatalf("RefreshChart: %v", err)
	}
	if versions != 3 {
		t.Fatalf("versions = %d, want 3", versions)
	}
	if len(catalog.forgot) != 1 || catalog.forgot[0] != "platform/egress-gateway" {
		t.Fatalf("forgot = %v, want the publication's own chart", catalog.forgot)
	}

	// The cache is shared, so who asked for it to be dropped is worth keeping.
	evs, err := svc.ListEvents(ctx, p.ID)
	if err != nil {
		t.Fatalf("ListEvents: %v", err)
	}
	var found *models.PublicationEvent
	for _, e := range evs {
		if e.EventType == "refreshed" {
			found = e
		}
	}
	if found == nil {
		t.Fatalf("no event recorded, got %d events", len(evs))
	}
	if found.Actor != owner.Subject {
		t.Fatalf("actor = %q, want %q", found.Actor, owner.Subject)
	}
	if _, ok := found.Payload["versions"]; !ok {
		t.Fatalf("the event does not say how many versions were dropped: %v", found.Payload)
	}
}

// Somebody else's chart is somebody else's: the cache is shared, and a stranger
// emptying it makes every reader pay for the registry again.
func TestAStrangerCannotHaveTheChartReRead(t *testing.T) {
	ctx := context.Background()
	catalog := &forgetful{versions: 3}
	svc, p := withCatalog(t, catalog)

	if _, err := svc.RefreshChart(ctx, member("other"), p.ID); !errors.Is(err, publications.ErrForbidden) {
		t.Fatalf("RefreshChart by a stranger = %v, want ErrForbidden", err)
	}
	if len(catalog.forgot) != 0 {
		t.Fatalf("the cache was dropped anyway: %v", catalog.forgot)
	}
	if _, err := svc.RefreshChart(ctx, admin(), p.ID); err != nil {
		t.Fatalf("RefreshChart by an admin: %v", err)
	}
}

// A registry that cannot be reached is reported, not rounded down to "nothing
// was cached": the person asked for the chart to be read again and has to know
// that it was not.
func TestAFailedReReadIsReported(t *testing.T) {
	ctx := context.Background()
	svc, p := withCatalog(t, &forgetful{err: models.ErrUpstream})

	if _, err := svc.RefreshChart(ctx, member("core"), p.ID); !errors.Is(err, models.ErrUpstream) {
		t.Fatalf("RefreshChart = %v, want the upstream failure", err)
	}
}
