package api_test

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"console/internal/api"
)

// The order and people gauges are counted from the shared database by the
// leading replica only. One that loses the lease stops publishing them, or
// summing the replicas would count the platform once per former leader.
func TestMetricsForgottenWhenTheLeaseIsLost(t *testing.T) {
	srv, _, _ := newServer(t)
	ctx := context.Background()
	leading := true
	srv.Leader = func() bool { return leading }
	scrape := func() string {
		rec := httptest.NewRecorder()
		api.MetricsHandler().ServeHTTP(rec, httptest.NewRequest("GET", "/metrics", nil))
		return rec.Body.String()
	}

	led := srv.MetricsStep(ctx, false)
	if !led || !strings.Contains(scrape(), `console_orders{status="DRAFT"}`) {
		t.Fatalf("the leader publishes the order gauge")
	}
	leading = false
	if led = srv.MetricsStep(ctx, led); led {
		t.Fatalf("a replica without the lease does not lead")
	}
	if body := scrape(); strings.Contains(body, `console_orders{`) || strings.Contains(body, `console_users{`) {
		t.Fatalf("a former leader still publishes stored counts:\n%s", body)
	}
}
