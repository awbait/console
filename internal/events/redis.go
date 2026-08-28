package events

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/redis/go-redis/v9"

	"console/internal/observability"
)

// DefaultChannel is the Redis channel the replicas talk on. One channel for
// every topic: the fan-out is done locally, by the in-process bus each replica
// keeps, and a channel per order would mean a subscription per open browser tab
// held on the Redis connection.
const DefaultChannel = "console:events"

// outboundBuffer is how many events may be waiting to reach Redis. Publish must
// not block the request that caused the change - a status transition is worth
// more than the notice about it - so a full buffer drops, and the drop is
// counted. It is generous next to the traffic: an event is a few hundred bytes
// and a busy portal produces a handful per second.
const outboundBuffer = 256

// Redis is a Bus shared by every replica. Locally it is the in-process bus, so
// a browser connected here hears a change made here with no round trip; the
// same event also goes to Redis, where the other replicas pick it up and hand
// it to their own subscribers.
//
// Delivery is best-effort in both directions, which is what the SSE contract
// already assumed: a client that misses an event re-reads the state it is
// looking at on the next connect, and every screen has a plain HTTP endpoint
// behind it.
type Redis struct {
	local   *Memory
	cli     *redis.Client
	channel string
	// origin is this replica's identity on the bus. An event carries it so the
	// replica that published it does not deliver it twice: once locally and
	// once more when Redis hands it back on the same subscription.
	origin string
	log    *slog.Logger
	out    chan []byte
}

var _ Bus = (*Redis)(nil)

// envelope is one event on the wire. Event itself hides its topic from JSON
// (the SSE payload has no use for it), and here the topic is the whole point.
type envelope struct {
	Origin string         `json:"origin"`
	Topic  string         `json:"topic"`
	Type   string         `json:"type"`
	Data   map[string]any `json:"data,omitempty"`
}

// NewRedis builds a bus over an existing Redis client. origin identifies this
// replica and must differ between them; channel may be empty for the default.
// Nothing is sent or received until Run is called.
func NewRedis(cli *redis.Client, channel, origin string, log *slog.Logger) *Redis {
	if channel == "" {
		channel = DefaultChannel
	}
	if log == nil {
		log = slog.Default()
	}
	return &Redis{
		local: New(), cli: cli, channel: channel, origin: origin, log: log,
		out: make(chan []byte, outboundBuffer),
	}
}

// Subscribe registers a local subscriber, exactly as the in-process bus does.
// Where the event was published - here or on another replica - is not something
// a subscriber has to know.
func (r *Redis) Subscribe(topic string) (<-chan Event, func()) { return r.local.Subscribe(topic) }

// Publish hands the event to the local subscribers and queues it for the other
// replicas. Non-blocking: if the queue to Redis is full the event only reaches
// the browsers connected here.
func (r *Redis) Publish(e Event) {
	r.local.Publish(e)

	payload, err := json.Marshal(envelope{Origin: r.origin, Topic: e.Topic, Type: e.Type, Data: e.Data})
	if err != nil {
		// Data comes from the domains, not from a request body, so this is a
		// programming error rather than bad input.
		r.log.Error("event not encoded for the bus", "topic", e.Topic, "type", e.Type, "err", err)
		observability.ObserveBusEvent("out", "error")
		return
	}
	select {
	case r.out <- payload:
		observability.ObserveBusEvent("out", "ok")
	default:
		observability.ObserveBusEvent("out", "dropped")
		r.log.Warn("event not sent to the other replicas: the bus queue is full",
			"topic", e.Topic, "type", e.Type)
	}
}

// Run blocks until ctx is cancelled, carrying events to Redis and back. It must
// be running for the replicas to hear each other; the local half works without
// it, so a portal whose Redis is unreachable still updates the browsers
// connected to it.
func (r *Redis) Run(ctx context.Context) {
	done := make(chan struct{})
	go func() {
		defer close(done)
		r.receive(ctx)
	}()
	r.send(ctx)
	<-done
}

// send drains the outbound queue onto the channel. One goroutine, so the order
// events were published in is the order they are sent in.
func (r *Redis) send(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case payload := <-r.out:
			if err := r.cli.Publish(ctx, r.channel, payload).Err(); err != nil {
				if ctx.Err() != nil {
					return
				}
				// Nothing is retried: by the time a second attempt succeeded the
				// event would be describing a state the client has already
				// re-read. The count is what an alert is written against.
				observability.ObserveBusEvent("out", "error")
				r.log.Warn("event not delivered to the other replicas", "err", err)
			}
		}
	}
}

// receive delivers what the other replicas published to the local subscribers.
func (r *Redis) receive(ctx context.Context) {
	sub := r.cli.Subscribe(ctx, r.channel)
	defer func() { _ = sub.Close() }()

	// Channel() re-subscribes by itself after a dropped connection; what is
	// published while it is down is gone, which is the same guarantee as a slow
	// subscriber already has.
	ch := sub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			r.deliver([]byte(msg.Payload))
		}
	}
}

// deliver hands one event from another replica to the local subscribers. Our
// own is dropped: Publish has already delivered it here, and Redis returns it
// on the same subscription it was sent on.
func (r *Redis) deliver(payload []byte) {
	var env envelope
	if err := json.Unmarshal(payload, &env); err != nil {
		observability.ObserveBusEvent("in", "error")
		r.log.Warn("unreadable event on the bus", "err", err)
		return
	}
	if env.Origin == r.origin {
		return
	}
	observability.ObserveBusEvent("in", "ok")
	r.local.Publish(Event{Topic: env.Topic, Type: env.Type, Data: env.Data})
}
