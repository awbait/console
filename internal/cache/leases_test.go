package cache

import (
	"context"
	"testing"
	"time"
)

// TestMemoryLeases drives the in-memory Leases through the decisions the
// Redis scripts make: a free key is taken, an owner renews their own, another
// owner is refused and told who holds it, only the owner releases, and a lease
// nobody renews expires on its own.
func TestMemoryLeases(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC)
	m := NewMemory()
	m.now = func() time.Time { return now }
	const key = "edit:pub:1:1.0.0"

	held, cur, err := m.Acquire(ctx, key, "alice", []byte("a1"), time.Minute)
	if err != nil || !held || cur != nil {
		t.Fatalf("first acquire: held=%v cur=%v err=%v", held, cur, err)
	}

	// Somebody else is refused and sees the holder, and the key is untouched.
	held, cur, err = m.Acquire(ctx, key, "bob", []byte("b1"), time.Minute)
	if err != nil || held || cur == nil || cur.Owner != "alice" || string(cur.Payload) != "a1" {
		t.Fatalf("other acquire: held=%v cur=%+v err=%v", held, cur, err)
	}

	// The owner renews: new payload, new expiry.
	now = now.Add(50 * time.Second)
	held, _, err = m.Acquire(ctx, key, "alice", []byte("a2"), time.Minute)
	if err != nil || !held {
		t.Fatalf("renew: held=%v err=%v", held, err)
	}
	if h, _ := m.Holder(ctx, key); h == nil || string(h.Payload) != "a2" {
		t.Fatalf("holder after renew: %+v", h)
	}

	// Past the original expiry but inside the renewed one: still alice's.
	now = now.Add(30 * time.Second)
	if h, _ := m.Holder(ctx, key); h == nil || h.Owner != "alice" {
		t.Fatalf("holder after renewal window: %+v", h)
	}

	// Only the owner releases.
	if ok, _ := m.Release(ctx, key, "bob"); ok {
		t.Fatal("bob released alice's lease")
	}
	if ok, _ := m.Release(ctx, key, "alice"); !ok {
		t.Fatal("alice could not release her own lease")
	}
	if h, _ := m.Holder(ctx, key); h != nil {
		t.Fatalf("holder after release: %+v", h)
	}
	if ok, _ := m.Release(ctx, key, "alice"); ok {
		t.Fatal("released a lease nobody holds")
	}

	// A lease nobody renews expires, and the next comer takes it.
	if held, _, _ := m.Acquire(ctx, key, "alice", []byte("a3"), time.Minute); !held {
		t.Fatal("re-acquire after release")
	}
	now = now.Add(61 * time.Second)
	if h, _ := m.Holder(ctx, key); h != nil {
		t.Fatalf("holder after expiry: %+v", h)
	}
	held, cur, _ = m.Acquire(ctx, key, "bob", []byte("b2"), time.Minute)
	if !held || cur != nil {
		t.Fatalf("acquire after expiry: held=%v cur=%+v", held, cur)
	}

	// Seize hands the key over whoever holds it.
	if err := m.Seize(ctx, key, "carol", []byte("c1"), time.Minute); err != nil {
		t.Fatalf("seize: %v", err)
	}
	if h, _ := m.Holder(ctx, key); h == nil || h.Owner != "carol" {
		t.Fatalf("holder after seize: %+v", h)
	}
}

// TestLeaseEncoding pins the wire format Redis stores: owner, NUL, payload.
// Both scripts find the owner by the first NUL, so a change here is a change
// there.
func TestLeaseEncoding(t *testing.T) {
	raw := encodeLease("alice", []byte(`{"since":1}`))
	if string(raw) != "alice\x00{\"since\":1}" {
		t.Fatalf("encoded = %q", raw)
	}
	l := decodeLease(raw)
	if l.Owner != "alice" || string(l.Payload) != `{"since":1}` {
		t.Fatalf("decoded = %+v", l)
	}
	if l := decodeLease([]byte("bare")); l.Owner != "bare" || l.Payload != nil {
		t.Fatalf("decoded bare = %+v", l)
	}
}
