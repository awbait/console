package catalog

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"console/internal/cache"
	"console/internal/harbor"
	"console/pkg/models"
)

// downHarbor answers every call with the same failure, standing in for a
// registry that is unreachable or refuses to talk.
type downHarbor struct{ err error }

func (h downHarbor) ListCharts(context.Context) ([]models.Chart, error) { return nil, h.err }
func (h downHarbor) GetChart(context.Context, string, string) (*models.Chart, error) {
	return nil, h.err
}
func (h downHarbor) ListVersions(context.Context, string, string) ([]models.ChartVersion, error) {
	return nil, h.err
}
func (h downHarbor) GetVersion(context.Context, string, string, string) (*models.ChartVersion, error) {
	return nil, h.err
}
func (h downHarbor) GetValues(context.Context, string, string, string) ([]byte, error) {
	return nil, h.err
}
func (h downHarbor) GetReadme(context.Context, string, string, string) ([]byte, error) {
	return nil, h.err
}
func (h downHarbor) GetSchema(context.Context, string, string, string) ([]byte, error) {
	return nil, h.err
}
func (h downHarbor) GetChangelog(context.Context, string, string, string) ([]byte, error) {
	return nil, h.err
}
func (h downHarbor) GetDependencies(context.Context, string, string, string) ([]models.ChartDependency, error) {
	return nil, h.err
}
func (h downHarbor) Healthz(context.Context) error { return h.err }

// An unreachable registry must reach the API layer as ErrUpstream (502), not as
// an unclassified error: that one becomes a 500 whose body is the bare code
// "internal", which tells the user nothing and hides an outage.
func TestHarborOutageIsUpstream(t *testing.T) {
	svc := New(downHarbor{err: errors.New("dial tcp: connection refused")}, cache.NewMemory())
	ctx := context.Background()

	calls := map[string]func() error{
		"ListCharts": func() error { _, err := svc.ListCharts(ctx, nil); return err },
		"Authorize":  func() error { _, err := svc.Authorize(ctx, nil, "lib", "gw"); return err },
		"GetChart":   func() error { _, err := svc.GetChart(ctx, "lib", "gw"); return err },
		"GetVersion": func() error { _, err := svc.GetVersion(ctx, "lib", "gw", "1.0.0"); return err },
		"GetValues":  func() error { _, err := svc.GetValues(ctx, "lib", "gw", "1.0.0"); return err },
		"GetSchema":  func() error { _, err := svc.GetSchema(ctx, "lib", "gw", "1.0.0"); return err },
		"CheckChart": func() error { _, err := svc.CheckChart(ctx, "lib", "gw"); return err },
	}
	for name, call := range calls {
		if err := call(); !errors.Is(err, models.ErrUpstream) {
			t.Errorf("%s: got %v, want ErrUpstream", name, err)
		}
	}
}

// A chart that is simply absent is the caller's problem, so it must keep its
// ErrNotFound (404) instead of being reported as an outage.
func TestMissingChartStaysNotFound(t *testing.T) {
	svc := New(downHarbor{err: models.ErrNotFound}, cache.NewMemory())
	ctx := context.Background()

	if _, err := svc.GetChart(ctx, "lib", "gw"); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("GetChart: got %v, want ErrNotFound", err)
	}
	if errors.Is(mustErr(svc.GetVersion(ctx, "lib", "gw", "1.0.0")), models.ErrUpstream) {
		t.Fatal("GetVersion: a missing version must not read as an outage")
	}
	// CheckChart reports a missing chart, it does not fail.
	res, err := svc.CheckChart(ctx, "lib", "gw")
	if err != nil {
		t.Fatalf("CheckChart: unexpected error %v", err)
	}
	if res.OK || res.Error == "" {
		t.Fatalf("CheckChart: want a report of a missing chart, got %+v", res)
	}
}

func mustErr[T any](_ T, err error) error { return err }

// Re-reading a chart has to drop every file of every version. A chart pushed
// again under a version that already exists is served from the entry written
// before it for a month, and a kind left behind - the dependency list, say -
// means the form keeps being drawn from the schema the person asked to replace.
func TestForgetDropsEveryFileOfEveryVersion(t *testing.T) {
	ctx := context.Background()
	c := cache.NewMemory()
	svc := New(harbor.NewFake(), c)

	for _, v := range []string{"15.4.1", "15.4.2"} {
		if _, err := svc.GetSchema(ctx, "platform", "postgres", v); err != nil {
			t.Fatalf("GetSchema %s: %v", v, err)
		}
		if _, err := svc.GetValues(ctx, "platform", "postgres", v); err != nil {
			t.Fatalf("GetValues %s: %v", v, err)
		}
	}
	if _, ok, _ := c.Get(ctx, cacheKey(kindSchema, "sha256:pg1542")); !ok {
		t.Fatal("the schema was not cached, so this test proves nothing")
	}

	versions, err := svc.Forget(ctx, "platform", "postgres")
	if err != nil {
		t.Fatalf("Forget: %v", err)
	}
	if versions != 2 {
		t.Fatalf("Forget dropped %d versions, want 2", versions)
	}
	for _, digest := range []string{"sha256:pg1541", "sha256:pg1542"} {
		for _, kind := range blobKinds {
			if _, ok, _ := c.Get(ctx, cacheKey(kind, digest)); ok {
				t.Errorf("%s of %s is still cached", kind, digest)
			}
		}
	}
}

// A registry that cannot be reached cannot say which versions a chart has, and
// the entries are keyed by digest - there is no way to find them without it. The
// outage is reported rather than read as a chart with nothing cached.
func TestForgetReportsAnUnreachableRegistry(t *testing.T) {
	svc := New(downHarbor{err: errors.New("dial tcp: connection refused")}, cache.NewMemory())
	if _, err := svc.Forget(context.Background(), "lib", "gw"); !errors.Is(err, models.ErrUpstream) {
		t.Fatalf("Forget: got %v, want ErrUpstream", err)
	}
}

// A cache entry written by an earlier build must not be read back. The body is
// keyed by the chart's digest, which says the archive has not changed; it says
// nothing about how much of that archive the portal takes out of it. When a
// release starts reading more - the dependency list gained the subcharts'
// values.yaml, without which an order is held to rules Helm does not apply - the
// entries already in Redis stay valid for another month, and the fix reaches
// nobody until they expire.
func TestCacheIgnoresEntriesOfAnEarlierFormat(t *testing.T) {
	ctx := context.Background()
	c := cache.NewMemory()
	svc := New(harbor.NewFake(), c)

	// The key the previous format wrote under: the kind and the digest, with
	// nothing between them.
	if err := c.Set(ctx, "schema:sha256:pg1542", []byte(`{"stale":true}`), time.Hour); err != nil {
		t.Fatalf("seed the cache: %v", err)
	}
	got, err := svc.GetSchema(ctx, "platform", "postgres", "15.4.2")
	if err != nil {
		t.Fatalf("GetSchema: %v", err)
	}
	if strings.Contains(string(got), "stale") {
		t.Fatal("GetSchema read an entry written before the format changed")
	}
}
