package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"console/pkg/models"
)

// recordErrs returns a Server whose log lands in buf, so a test can assert on
// what a failed request left behind.
func recordErrs(buf *bytes.Buffer) *Server {
	return &Server{Log: slog.New(slog.NewJSONHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug}))}
}

func TestNotConfiguredIsNotAnOutage(t *testing.T) {
	var buf bytes.Buffer
	s := recordErrs(&buf)
	w := httptest.NewRecorder()
	err := fmt.Errorf("%w: gitlab group: gitlab: status 403: forbidden", models.ErrNotConfigured)
	s.writeDomainErr(w, httptest.NewRequest(http.MethodPost, "/api/v1/requests/x/submit", nil), err)

	// 409, not 502: the platform is up. A 502 would trip the health probe
	// (server.go) and raise the outage banner in the SPA.
	if w.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", w.Code)
	}
	var body errorBody
	if derr := json.Unmarshal(w.Body.Bytes(), &body); derr != nil {
		t.Fatalf("decode: %v", derr)
	}
	if body.Error != "not_configured" {
		t.Fatalf("code = %q, want not_configured", body.Error)
	}
	if !strings.Contains(buf.String(), "status 403") {
		t.Fatalf("cause missing from the log: %s", buf.String())
	}
}

func TestUpstreamFailureIsLogged(t *testing.T) {
	var buf bytes.Buffer
	s := recordErrs(&buf)
	w := httptest.NewRecorder()
	err := fmt.Errorf("%w: gitlab commit: dial tcp: connection refused", models.ErrUpstream)
	s.writeDomainErr(w, httptest.NewRequest(http.MethodPost, "/api/v1/requests/x/submit", nil), err)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", w.Code)
	}
	// The whole chain, not just the sentinel: without it the log says "an
	// upstream failed" and the person on support still has to guess which.
	line := buf.String()
	if !strings.Contains(line, "connection refused") || !strings.Contains(line, `"level":"WARN"`) {
		t.Fatalf("want a warn line carrying the cause, got: %s", line)
	}
	if !strings.Contains(line, `"path":"/api/v1/requests/x/submit"`) {
		t.Fatalf("want the path in the line, got: %s", line)
	}
}

func TestExpectedFailuresAreNotLogged(t *testing.T) {
	// A deleted order and a form that did not validate are answers, not faults.
	// Logging them would drown the lines that mean something.
	for _, err := range []error{models.ErrNotFound, models.ErrConflict, models.ErrStaleVersion} {
		var buf bytes.Buffer
		s := recordErrs(&buf)
		s.writeDomainErr(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/v1/requests/x", nil), err)
		if buf.Len() != 0 {
			t.Fatalf("%v logged: %s", err, buf.String())
		}
	}
}

func TestUnknownFailureIsLoggedAsError(t *testing.T) {
	var buf bytes.Buffer
	s := recordErrs(&buf)
	w := httptest.NewRecorder()
	s.writeDomainErr(w, httptest.NewRequest(http.MethodGet, "/api/v1/requests", nil),
		fmt.Errorf("scan requests: sql: expected 4 destination arguments"))

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", w.Code)
	}
	// The response says only "internal"; the log is the sole copy of the cause.
	line := buf.String()
	if !strings.Contains(line, "expected 4 destination arguments") || !strings.Contains(line, `"level":"ERROR"`) {
		t.Fatalf("want an error line carrying the cause, got: %s", line)
	}
}
