package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"console/internal/api"
	"console/internal/checks"
)

// fixedChecks stands in for the background check runner with a snapshot the test
// controls, and records that a round was asked for.
type fixedChecks struct {
	snap      checks.Snapshot
	triggered int
}

func (f *fixedChecks) Snapshot() checks.Snapshot { return f.snap }
func (f *fixedChecks) Trigger(string)            { f.triggered++ }

// TestStatusChecksRestrictedToAdmin keeps the configuration checks where the
// rest of the status page already is: they name variables, group paths and
// account names, which nobody else on the portal has any business reading.
func TestStatusChecksRestrictedToAdmin(t *testing.T) {
	srv, _, _ := newServer(t)
	srv.Checks = &fixedChecks{snap: checks.Snapshot{
		CheckedAt: time.Now(),
		Results: []checks.CheckResult{
			{ID: checks.IDGitLabToken, Component: checks.ComponentGitLab, Verdict: checks.VerdictOK},
		},
	}}
	h := srv.Router()

	for _, path := range []string{"/api/v1/status/checks", "/api/v1/status/checks/run", "/api/v1/status/checks/webhook-delivery"} {
		method := http.MethodGet
		if path != "/api/v1/status/checks" {
			method = http.MethodPost
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, devReq(method, path, "core", nil))
		if rec.Code != http.StatusForbidden {
			t.Fatalf("%s as a member: %d, want 403", path, rec.Code)
		}
	}

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, adminReq(http.MethodGet, "/api/v1/status/checks", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("admin checks: %d body=%s", rec.Code, rec.Body.String())
	}
	var got api.ChecksResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode checks: %v", err)
	}
	if len(got.Results) != 1 || got.Results[0].ID != checks.IDGitLabToken {
		t.Fatalf("got %+v", got.Results)
	}
	if got.CheckedAt == "" {
		t.Fatal("the page cannot say how fresh the answer is")
	}
	if got.IntervalSeconds != int(checks.Interval.Seconds()) {
		t.Fatalf("interval = %d, want %d", got.IntervalSeconds, int(checks.Interval.Seconds()))
	}
}

// TestRunStatusChecksQueuesARound covers the button: it answers as soon as the
// round is queued, because the round itself takes seconds and the page polls.
func TestRunStatusChecksQueuesARound(t *testing.T) {
	srv, _, _ := newServer(t)
	runner := &fixedChecks{}
	srv.Checks = runner

	rec := httptest.NewRecorder()
	srv.Router().ServeHTTP(rec, adminReq(http.MethodPost, "/api/v1/status/checks/run", nil))
	if rec.Code != http.StatusAccepted {
		t.Fatalf("run checks: %d body=%s", rec.Code, rec.Body.String())
	}
	if runner.triggered != 1 {
		t.Fatalf("queued %d rounds, want 1", runner.triggered)
	}
}

// TestChecksAbsentAnswerEmpty covers a server built without a runner (tests, and
// any future wiring that leaves it out): the page must render, not error.
func TestChecksAbsentAnswerEmpty(t *testing.T) {
	srv, _, _ := newServer(t)

	rec := httptest.NewRecorder()
	srv.Router().ServeHTTP(rec, adminReq(http.MethodGet, "/api/v1/status/checks", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("checks without a runner: %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	srv.Router().ServeHTTP(rec, adminReq(http.MethodPost, "/api/v1/status/checks/webhook-delivery", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("delivery test without wiring: %d, want 503", rec.Code)
	}
}

// TestWebhookDeliveryTestRuns covers the one active check: it is a request, it
// answers with an outcome, and it is behind the same admin gate.
func TestWebhookDeliveryTestRuns(t *testing.T) {
	srv, _, _ := newServer(t)
	srv.TestWebhookDelivery = func(context.Context) checks.DeliveryTest {
		return checks.DeliveryTest{Outcome: checks.DeliveryDelivered, Facts: map[string]string{"scope": "group"}}
	}

	rec := httptest.NewRecorder()
	srv.Router().ServeHTTP(rec, adminReq(http.MethodPost, "/api/v1/status/checks/webhook-delivery", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("delivery test: %d body=%s", rec.Code, rec.Body.String())
	}
	var got checks.DeliveryTest
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode delivery test: %v", err)
	}
	if got.Outcome != checks.DeliveryDelivered {
		t.Fatalf("outcome = %q", got.Outcome)
	}
}
