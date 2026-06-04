package status

import (
	"context"
	"log/slog"
	"time"
)

// Reconciler advances state on each tick. Both the fake ArgoCD (materialise
// apps from git) and the provisioning service implement it.
type Reconciler interface {
	Reconcile(ctx context.Context) error
}

// Poller runs the reconcilers on an interval. MVP is single-replica, so this
// runs in-process with no leader election (see spec techdebt note).
type Poller struct {
	interval    time.Duration
	reconcilers []Reconciler
	log         *slog.Logger
}

// NewPoller builds a poller. Reconcilers run in order each tick.
func NewPoller(interval time.Duration, log *slog.Logger, reconcilers ...Reconciler) *Poller {
	return &Poller{interval: interval, reconcilers: reconcilers, log: log}
}

// Run blocks, ticking until the context is cancelled. It also reconciles once
// immediately on start.
func (p *Poller) Run(ctx context.Context) {
	t := time.NewTicker(p.interval)
	defer t.Stop()
	p.tick(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			p.tick(ctx)
		}
	}
}

func (p *Poller) tick(ctx context.Context) {
	for _, r := range p.reconcilers {
		if err := r.Reconcile(ctx); err != nil {
			p.log.Warn("reconcile failed", "err", err)
		}
	}
}
