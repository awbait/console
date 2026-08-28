// Package leader decides which replica of the portal runs the background work.
//
// Everything the portal does on its own - advancing orders, merging its own
// merge requests, discovering charts, sweeping notifications, refreshing the
// gauges - is written to run once. Two replicas doing it at the same time is
// not twice the work but a different thing: two sweeps ask GitLab and Argo CD
// the same questions, and then race each other writing the answers back onto
// the same order.
//
// So exactly one replica does it and the others stand by. Which one is decided
// by a lease: a key in Redis naming its holder, short enough that a replica
// which dies is replaced within half a minute and nobody notices the leader was
// gone. The loops are periodic, and a missed tick is a late tick.
//
// The events bus is the other half of running more than one replica: see
// internal/events.
package leader

import (
	"context"
	"time"

	"console/internal/observability"
)

// Elector answers the only question the background loops ask: is this replica
// the one that does the work.
type Elector interface {
	IsLeader() bool
}

// Lease is what an election is decided by: one key, held by one replica at a
// time, that stops being held if it is not renewed. Redis has it as SET NX with
// an expiry (see redis.go); the interface is what keeps the rules above
// testable without one.
//
// Every method reports what the holder of the lease is, not what it wants: Take
// and Keep return false when the lease is somebody else's, and an error only
// when the answer is unknown.
type Lease interface {
	// Take claims the lease for ttl if nobody holds it.
	Take(ctx context.Context, ttl time.Duration) (bool, error)
	// Keep extends a lease this replica already holds. False means it does not
	// hold it any more.
	Keep(ctx context.Context, ttl time.Duration) (bool, error)
	// Release hands the lease back, if it is still ours to hand back.
	Release(ctx context.Context) error
}

// solo is the elector of a portal that is not sharing anything. It always
// leads, which is exactly right for a single replica and for tests.
type solo struct{}

// Solo returns an elector that always leads, for a portal without a shared
// backend to hold a lease in (CACHE=memory). Running more than one replica in
// that mode is what this package exists to prevent, and nothing here can
// prevent it: with nothing shared there is nothing for the replicas to agree
// through.
func Solo() Elector {
	observability.SetLeader(true)
	return solo{}
}

func (solo) IsLeader() bool { return true }
