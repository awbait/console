package webhooks

import (
	"sync"
	"time"
)

// What actually arrived, as opposed to what is configured.
//
// The two sides of a webhook agree on a secret that neither will show the other:
// GitLab never returns the token it stores, and the portal must never print the
// one it holds. So "do the secrets match" cannot be read anywhere - but it can
// be counted. A delivery rejected on its secret is a diagnosis in itself, and it
// costs nothing to keep: the handler already knows, it just used to throw the
// fact away after one log line.
//
// The counters live in memory and start at zero on every boot. That is the point
// rather than a limitation: "no delivery since the portal started" is what an
// admin needs to see, and a number carried over from the previous process would
// hide exactly the case where a hook broke during a deploy.

// Delivery outcomes, matching what the handler does with a request.
const (
	OutcomeAccepted   = "accepted"     // the secret matched and the event was acted on
	OutcomeIgnored    = "ignored"      // the secret matched, the event was not one we act on
	OutcomeRejected   = "unauthorized" // the secret did not match
	OutcomeBadRequest = "bad_request"  // the secret matched, the body did not parse
)

// SourceDeliveries is what one webhook source has sent since the portal started.
type SourceDeliveries struct {
	Accepted   int `json:"accepted"`
	Ignored    int `json:"ignored"`
	Rejected   int `json:"rejected"`
	BadRequest int `json:"bad_request"`
	// LastAt is the most recent delivery of any outcome, LastAccepted and
	// LastRejected the most recent of theirs. Zero means it never happened.
	LastAt       time.Time `json:"last_at,omitzero"`
	LastAccepted time.Time `json:"last_accepted,omitzero"`
	LastRejected time.Time `json:"last_rejected,omitzero"`
}

// Total is how many deliveries arrived, whatever became of them. A source with
// zero of these has not reached the portal at all, which is a different problem
// from one whose deliveries are all rejected.
func (d SourceDeliveries) Total() int {
	return d.Accepted + d.Ignored + d.Rejected + d.BadRequest
}

// Deliveries counts inbound webhook deliveries per source. The zero value is not
// usable; build it with newDeliveries (the handler does).
type Deliveries struct {
	mu    sync.Mutex
	since time.Time
	bySrc map[string]*SourceDeliveries
	nowFn func() time.Time // clock, injectable in tests
}

// newDeliveries builds a recorder that counts from now.
func newDeliveries() *Deliveries {
	return &Deliveries{since: time.Now(), bySrc: map[string]*SourceDeliveries{}, nowFn: time.Now}
}

// record notes one delivery from a source.
func (d *Deliveries) record(source, outcome string) {
	if d == nil {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	s := d.bySrc[source]
	if s == nil {
		s = &SourceDeliveries{}
		d.bySrc[source] = s
	}
	now := d.nowFn()
	s.LastAt = now
	switch outcome {
	case OutcomeAccepted:
		s.Accepted++
		s.LastAccepted = now
	case OutcomeIgnored:
		s.Ignored++
		s.LastAccepted = now // the secret matched: for "is this wired up", that is the same news
	case OutcomeRejected:
		s.Rejected++
		s.LastRejected = now
	case OutcomeBadRequest:
		s.BadRequest++
	}
}

// Since is when counting began, i.e. when the portal started.
func (d *Deliveries) Since() time.Time {
	if d == nil {
		return time.Time{}
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.since
}

// Get returns the counters for one source ("gitlab", "harbor"). A source that
// has never delivered returns the zero value, which reads as "nothing arrived".
func (d *Deliveries) Get(source string) SourceDeliveries {
	if d == nil {
		return SourceDeliveries{}
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if s := d.bySrc[source]; s != nil {
		return *s
	}
	return SourceDeliveries{}
}
