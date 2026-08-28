package leader

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"console/internal/observability"
)

// DefaultTTL is how long a lease lasts without being renewed. It is the price
// of a leader dying: nothing reconciles until the lease expires and another
// replica takes it. Half a minute is short next to the poll interval it delays
// and long next to the renewals inside it, so a slow round trip or a paused
// process does not cost leadership.
const DefaultTTL = 30 * time.Second

// renewDivisor sets how often the lease is renewed: TTL/3, so two renewals in a
// row have to fail before the lease is at risk.
const renewDivisor = 3

// opTimeout bounds one call to the lease. Well under the renewal interval: a
// call that has not answered by then is not going to help, and the next one is
// due.
const opTimeout = 5 * time.Second

// Election keeps a lease if this replica has it and takes it if nobody does.
//
// It never claims leadership it cannot prove. When the lease backend stops
// answering, the lease is kept until the moment it would have expired and then
// dropped: no other replica can take it before then, and after then this one
// has no way to know whether it still holds it.
type Election struct {
	lease Lease
	log   *slog.Logger

	// TTL is how long one lease lasts. Set it before Run; zero means DefaultTTL.
	TTL time.Duration

	// mu guards the state below: Run writes it, IsLeader reads it from whichever
	// goroutine a background loop is on.
	mu sync.Mutex
	// claimed is whether the last answer said the lease is ours; until is the
	// moment it stops being ours if nothing renews it.
	claimed bool
	until   time.Time

	now func() time.Time // clock, injectable in tests
}

var _ Elector = (*Election)(nil)

// New builds an election over a lease. Nothing is claimed until Run is called.
func New(lease Lease, log *slog.Logger) *Election {
	if log == nil {
		log = slog.Default()
	}
	return &Election{lease: lease, log: log, now: time.Now}
}

// IsLeader reports whether this replica may run the background loops right now.
// It is false while the lease is held by somebody else, and false again the
// moment ours would have run out, whether or not the loop below has noticed.
func (e *Election) IsLeader() bool {
	if e == nil {
		return false
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.claimed && e.now().Before(e.until)
}

// ttl is the configured lease length, or the default.
func (e *Election) ttl() time.Duration {
	if e.TTL > 0 {
		return e.TTL
	}
	return DefaultTTL
}

// Run blocks, keeping or taking the lease until ctx is cancelled. On the way out
// it hands the lease back, so a rolling restart moves the work to another
// replica immediately instead of leaving it idle for the rest of the lease.
func (e *Election) Run(ctx context.Context) {
	t := time.NewTicker(e.ttl() / renewDivisor)
	defer t.Stop()
	e.Step(ctx)
	for {
		select {
		case <-ctx.Done():
			e.Resign()
			return
		case <-t.C:
			e.Step(ctx)
		}
	}
}

// Step is one round of keeping or taking the lease, and the only place the
// state changes. Run calls it on a timer; it is exported so a test can run the
// rounds itself.
func (e *Election) Step(ctx context.Context) {
	was := e.IsLeader()
	defer func() {
		is := e.IsLeader()
		observability.SetLeader(is)
		switch {
		case is && !was:
			e.log.Info("this replica now runs the background loops")
		case was && !is:
			e.log.Info("this replica no longer runs the background loops")
		}
	}()

	octx, cancel := context.WithTimeout(ctx, opTimeout)
	defer cancel()

	if e.claimedNow() {
		start := e.now()
		kept, err := e.lease.Keep(octx, e.ttl())
		switch {
		case err != nil:
			// The backend did not answer. Keeping the lease past its own expiry
			// would be claiming something we cannot check, so it runs out.
			e.expire(err)
			return
		case kept:
			e.hold(start)
			return
		}
		// The lease is somebody else's now. Fall through and see whether it is
		// free again by the time we ask.
		e.drop()
	}

	start := e.now()
	taken, err := e.lease.Take(octx, e.ttl())
	switch {
	case err != nil:
		e.log.Debug("could not take the lease on the background loops", "err", err)
	case taken:
		e.hold(start)
	}
}

// Resign hands the lease back, so the next replica to ask gets it straight
// away. Best-effort: the process is leaving, and if this does not get through
// the lease expires by itself.
func (e *Election) Resign() {
	if !e.claimedNow() {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()
	if err := e.lease.Release(ctx); err != nil {
		e.log.Debug("could not hand the lease back", "err", err)
	}
	e.drop()
	observability.SetLeader(false)
}

func (e *Election) claimedNow() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.claimed
}

// hold records a lease that is ours for a TTL counted from start - from before
// the call, not after, because the backend started the expiry at some point
// during it. A lease we think is shorter than it is can only make us step down
// early, which is the safe direction.
func (e *Election) hold(start time.Time) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.claimed = true
	e.until = start.Add(e.ttl())
}

// drop forgets a lease that is no longer ours.
func (e *Election) drop() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.claimed = false
	e.until = time.Time{}
}

// expire drops the lease once it has run out, and says so the one time. Until
// then nothing is said: a single unanswered renewal is normal and costs
// nothing, because two more are due before the lease is gone.
func (e *Election) expire(err error) {
	e.mu.Lock()
	expired := !e.now().Before(e.until)
	if expired {
		e.claimed = false
		e.until = time.Time{}
	}
	e.mu.Unlock()
	if expired {
		e.log.Warn("gave up the lease on the background loops: it could not be renewed", "err", err)
		return
	}
	e.log.Debug("lease renewal failed, the lease is still valid", "err", err)
}
