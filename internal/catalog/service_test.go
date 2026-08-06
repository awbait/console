package catalog

import (
	"context"
	"errors"
	"testing"

	"console/internal/cache"
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
