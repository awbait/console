package events

import (
	"encoding/json"
	"io"
	"log/slog"
	"testing"
	"time"
)

// bus builds a Redis bus with no client behind it. Everything below exercises
// what the bus does with an event on either side of the wire, which is where
// its own rules live; Redis itself is not what a unit test should be checking.
func bus(origin string) *Redis {
	return NewRedis(nil, DefaultChannel, origin, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

// wire is what Publish would have sent, taken from the outbound queue instead
// of from Redis.
func wire(t *testing.T, b *Redis) []byte {
	t.Helper()
	select {
	case payload := <-b.out:
		return payload
	case <-time.After(time.Second):
		t.Fatal("nothing was queued for the other replicas")
		return nil
	}
}

func TestPublishReachesTheBrowsersConnectedHere(t *testing.T) {
	b := bus("replica-a")
	ch, unsub := b.Subscribe("requests")
	defer unsub()

	b.Publish(Event{Topic: "requests", Type: "status_changed", Data: map[string]any{"id": "42"}})

	select {
	case got := <-ch:
		if got.Type != "status_changed" {
			t.Fatalf("event type %q, want status_changed", got.Type)
		}
	default:
		t.Fatal("a local subscriber did not get an event published here")
	}
}

func TestAnEventFromAnotherReplicaReachesTheSubscribers(t *testing.T) {
	them := bus("replica-b")
	them.Publish(Event{Topic: "request:42", Type: "status_changed", Data: map[string]any{"status": "HEALTHY"}})
	payload := wire(t, them)

	us := bus("replica-a")
	ch, unsub := us.Subscribe("request:42")
	defer unsub()

	us.deliver(payload)

	select {
	case got := <-ch:
		if got.Topic != "request:42" || got.Type != "status_changed" {
			t.Fatalf("got %+v, want the topic and type it was published with", got)
		}
		if got.Data["status"] != "HEALTHY" {
			t.Fatalf("payload %+v lost what the event was about", got.Data)
		}
	default:
		t.Fatal("an event from another replica did not reach the subscriber")
	}
}

func TestOurOwnEventIsNotDeliveredTwice(t *testing.T) {
	b := bus("replica-a")
	ch, unsub := b.Subscribe("requests")
	defer unsub()

	b.Publish(Event{Topic: "requests", Type: "status_changed"})
	<-ch // the local delivery

	// Redis hands the event back on the same subscription it was sent on.
	b.deliver(wire(t, b))

	select {
	case got := <-ch:
		t.Fatalf("the same event was delivered a second time: %+v", got)
	default:
	}
}

func TestTheTopicSurvivesTheWire(t *testing.T) {
	b := bus("replica-a")
	b.Publish(Event{Topic: TopicReconcile, Type: "reconcile_requested",
		Data: map[string]any{"reason": "gitlab: merge request merged"}})

	var env envelope
	if err := json.Unmarshal(wire(t, b), &env); err != nil {
		t.Fatalf("the envelope is not readable: %v", err)
	}
	// Event hides its topic from JSON - the SSE payload has no use for it - so
	// the envelope has to carry it, or nobody on the other side knows who the
	// event is for.
	if env.Topic != TopicReconcile {
		t.Fatalf("topic on the wire is %q, want %q", env.Topic, TopicReconcile)
	}
	if env.Origin != "replica-a" {
		t.Fatalf("origin on the wire is %q, want the replica that published it", env.Origin)
	}
}

func TestPublishDoesNotBlockWhenRedisIsBehind(t *testing.T) {
	b := bus("replica-a")
	// Fill the outbound queue: nothing is draining it in this test, which is
	// what a wedged Redis looks like from here.
	for range outboundBuffer + 10 {
		b.Publish(Event{Topic: "requests", Type: "status_changed"})
	}

	// The local subscribers still get everything: a browser connected here does
	// not wait on the replica it is not connected to.
	ch, unsub := b.Subscribe("requests")
	defer unsub()
	b.Publish(Event{Topic: "requests", Type: "status_changed"})
	select {
	case <-ch:
	default:
		t.Fatal("a full outbound queue stopped the local delivery")
	}
}

// TestASubscriberCanTellItsOwnEventFromAnothersProtects the counters that are
// kept on every replica: a webhook delivery is counted where it arrived and
// then announced, so the replica that announced it must not count it again.
func TestASubscriberCanTellItsOwnEventFromAnothers(t *testing.T) {
	them := bus("replica-b")
	them.Publish(Event{Topic: "webhooks", Type: "delivery_recorded"})
	fromThem := wire(t, them)

	us := bus("replica-a")
	ch, unsub := us.Subscribe("webhooks")
	defer unsub()

	us.Publish(Event{Topic: "webhooks", Type: "delivery_recorded"})
	if got := <-ch; !got.Local {
		t.Fatal("an event published here is not marked as ours, so it would be counted twice")
	}
	<-us.out // our own copy on its way to the other replicas

	us.deliver(fromThem)
	if got := <-ch; got.Local {
		t.Fatal("an event from another replica is marked as ours, so it would not be counted at all")
	}
}

// TestTheInProcessBusMarksEverythingLocal: with one replica every event is its
// own, and a subscriber that skips other replicas' events must still see all of
// them.
func TestTheInProcessBusMarksEverythingLocal(t *testing.T) {
	b := New()
	ch, unsub := b.Subscribe("webhooks")
	defer unsub()

	b.Publish(Event{Topic: "webhooks", Type: "delivery_recorded"})
	if got := <-ch; !got.Local {
		t.Fatal("the in-process bus published an event as if it came from somewhere else")
	}
}

func TestAnUnreadableEventIsDroppedNotPanicked(t *testing.T) {
	b := bus("replica-a")
	ch, unsub := b.Subscribe("requests")
	defer unsub()

	b.deliver([]byte("{not json"))

	select {
	case got := <-ch:
		t.Fatalf("something was delivered from an unreadable payload: %+v", got)
	default:
	}
}
