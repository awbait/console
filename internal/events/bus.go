// Package events is the portal's pub/sub: a status change is written once and
// heard by every browser that is looking at it, through the SSE endpoints.
//
// There are two buses behind one interface. In-process (Memory) is the whole
// bus when the portal runs as one replica: the publisher and the subscriber are
// in the same program, and nothing has to leave it. Redis carries the same
// events between replicas, because a browser is connected to one of them and
// the change is made on another.
//
// Which one is in use follows the cache backend, and that is the whole rule:
// with CACHE=redis the replicas share a bus, without it each one only hears
// itself. See internal/leader for the other half of running more than one.
package events

import "sync"

// Event is a status update for an order.
type Event struct {
	Topic string         `json:"-"`    // "requests" (all of them) or "request:<id>"
	Type  string         `json:"type"` // status_changed, mr_updated, ...
	Data  map[string]any `json:"data"`
	// Local is true when this replica published the event and false when it
	// came from another one. The bus sets it; what a publisher passes is
	// ignored.
	//
	// Most subscribers have no use for it - an event is an event, and where it
	// was published is the bus's business. It matters to a subscriber that has
	// already acted on its own copy by the time the event reaches it, and would
	// otherwise count the same thing twice.
	Local bool `json:"-"`
}

// Topics that are not a browser's business. They travel the same bus because
// the replica something happens on is not the replica that has to know about
// it (see internal/leader).
const (
	// TopicReconcile asks whoever runs the background loops to sweep now,
	// instead of waiting for the next tick.
	TopicReconcile = "reconcile"
	// TopicWebhooks carries the fact that a webhook was delivered, so every
	// replica counts a delivery that reached one of them. The counters are what
	// the configuration page reads and what the "check delivery" button waits
	// for, and a delivery lands on whichever replica the ingress picked.
	TopicWebhooks = "webhooks"
	// TopicSignIns carries what the last sign-in's token held. Sessions are
	// shared, so a person signs in through one replica and works on any of
	// them; the evidence of what the token carried has to travel with it, or
	// the check that reads it (internal/checks.KeycloakChecks) goes blind on
	// every replica but one.
	TopicSignIns = "sign-ins"
)

// Bus is what a publisher and a subscriber see. Memory and Redis implement it;
// the domains hold this interface, so which bus is wired is a decision main
// makes once.
type Bus interface {
	// Publish delivers an event to every subscriber of its topic. It does not
	// block: a subscriber that is not reading fast enough misses the event, and
	// SSE clients re-fetch on connect.
	Publish(e Event)
	// Subscribe returns a channel of events for a topic and the func that ends
	// the subscription. Calling it twice is safe.
	Subscribe(topic string) (<-chan Event, func())
}

// Memory is an in-process topic pub/sub. It is the whole bus for a single
// replica, and the local half of the Redis one.
type Memory struct {
	mu   sync.RWMutex
	subs map[string]map[chan Event]struct{}
}

var _ Bus = (*Memory)(nil)

// New returns an empty in-process bus.
func New() *Memory {
	return &Memory{subs: map[string]map[chan Event]struct{}{}}
}

// Subscribe returns a channel of events for a topic and an unsubscribe func.
func (b *Memory) Subscribe(topic string) (<-chan Event, func()) {
	ch := make(chan Event, 16)
	b.mu.Lock()
	if b.subs[topic] == nil {
		b.subs[topic] = map[chan Event]struct{}{}
	}
	b.subs[topic][ch] = struct{}{}
	b.mu.Unlock()

	return ch, func() {
		b.mu.Lock()
		if m, ok := b.subs[topic]; ok {
			if _, ok := m[ch]; ok {
				delete(m, ch)
				close(ch)
			}
			if len(m) == 0 {
				delete(b.subs, topic)
			}
		}
		b.mu.Unlock()
	}
}

// Publish delivers an event to all subscribers of its topic (non-blocking).
// Whoever calls it is the replica the event came from, so it is marked local.
func (b *Memory) Publish(e Event) {
	e.Local = true
	b.publish(e)
}

// publish is the fan-out itself, without deciding where the event came from.
// The Redis bus uses it to deliver another replica's event through this one.
func (b *Memory) publish(e Event) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for ch := range b.subs[e.Topic] {
		select {
		case ch <- e:
		default: // drop if subscriber is slow; SSE clients re-fetch on connect
		}
	}
}
