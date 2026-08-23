package api

import (
	"net/http"
	"time"

	"console/internal/auth"
	"console/internal/checks"
)

// The configuration checks live on their own endpoint rather than inside
// GET /api/v1/status. They answer a different question at a different rhythm:
// health is probed every few seconds and the page refreshes on it, while a
// configuration round costs a handful of upstream API calls and only changes
// when somebody deploys. Folding them together would make every status refresh
// carry a payload it did not ask for, or make the checks as stale as the
// slowest thing in it.

// checksSnapshotter is the slice of the check runner the API needs: the last
// result of every check, and a way to ask for a round now.
type checksSnapshotter interface {
	Snapshot() checks.Snapshot
	Trigger(reason string)
}

// ChecksResponse is the payload of GET /api/v1/status/checks.
type ChecksResponse struct {
	Results []checks.CheckResult `json:"results"`
	// CheckedAt is when the last round finished, RFC3339; empty before the first.
	CheckedAt string `json:"checked_at,omitempty"`
	// Running says a round is in flight, so the page can show its own answer as
	// the previous one rather than the current one.
	Running bool `json:"running"`
	// IntervalSeconds is how often the set runs by itself, so the page can say
	// so without repeating the number.
	IntervalSeconds int `json:"interval_seconds"`
}

// handleStatusChecks reports what the configuration checks found. Platform
// admins only, like the rest of the status page, and free: it reads the runner's
// in-memory snapshot and touches no upstream.
func (s *Server) handleStatusChecks(w http.ResponseWriter, r *http.Request) {
	if !s.adminOnly(w, r, "configuration checks") {
		return
	}
	if s.Checks == nil {
		writeJSON(w, http.StatusOK, ChecksResponse{IntervalSeconds: int(checks.Interval.Seconds())})
		return
	}
	snap := s.Checks.Snapshot()
	out := ChecksResponse{
		Results:         snap.Results,
		Running:         snap.Running,
		IntervalSeconds: int(checks.Interval.Seconds()),
	}
	if !snap.CheckedAt.IsZero() {
		out.CheckedAt = snap.CheckedAt.Format(time.RFC3339)
	}
	writeJSON(w, http.StatusOK, out)
}

// handleRunStatusChecks asks for a round now, for the admin who has just changed
// something and does not want to wait out the interval. It answers as soon as
// the round is queued, not when it finishes: the page polls the endpoint above,
// which reports a round in flight.
func (s *Server) handleRunStatusChecks(w http.ResponseWriter, r *http.Request) {
	if !s.adminOnly(w, r, "configuration checks") {
		return
	}
	if s.Checks == nil {
		writeErr(w, http.StatusServiceUnavailable, "internal", "configuration checks are not available")
		return
	}
	s.Checks.Trigger("admin requested")
	writeJSON(w, http.StatusAccepted, map[string]bool{"queued": true})
}

// handleTestWebhookDelivery asks GitLab to send the portal a sample delivery and
// reports whether it arrived. The only check that makes anything happen outside
// the portal, so it runs on this request and never on a schedule.
func (s *Server) handleTestWebhookDelivery(w http.ResponseWriter, r *http.Request) {
	if !s.adminOnly(w, r, "configuration checks") {
		return
	}
	if s.TestWebhookDelivery == nil {
		writeErr(w, http.StatusServiceUnavailable, "internal", "the webhook delivery test is not available")
		return
	}
	res := s.TestWebhookDelivery(r.Context())
	s.logger().Info("webhook delivery test", "source", "gitlab", "outcome", res.Outcome)
	writeJSON(w, http.StatusOK, res)
}

// adminOnly answers 403 unless the caller is a platform admin, and reports
// whether the handler may continue. what names the thing being guarded, so the
// refusal says which one it is.
func (s *Server) adminOnly(w http.ResponseWriter, r *http.Request, what string) bool {
	if u := auth.UserFrom(r.Context()); u != nil && u.IsAdmin() {
		return true
	}
	writeErr(w, http.StatusForbidden, "forbidden", what+" are restricted to platform admins")
	return false
}
