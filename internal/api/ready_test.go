package api_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// A stopping replica reports itself not ready while it still serves, so the
// load balancer moves the traffic before the listener closes.
func TestReadyAnswersNotReadyWhileDraining(t *testing.T) {
	srv, _, _ := newServer(t)
	ready := func() int {
		rec := httptest.NewRecorder()
		srv.Router().ServeHTTP(rec, httptest.NewRequest("GET", "/ready", nil))
		return rec.Code
	}
	if code := ready(); code != http.StatusOK {
		t.Fatalf("ready before the stop: %d", code)
	}
	srv.Draining.Store(true)
	if code := ready(); code != http.StatusServiceUnavailable {
		t.Fatalf("ready while draining: %d", code)
	}
}
