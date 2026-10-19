package provisioning

import (
	"context"
	"sync"
	"time"

	"console/internal/checks"
	"console/internal/store"
	"console/pkg/models"
)

// The checks of a stand: run from its page on request and in the background
// every StandChecksInterval, stored, and read back by the status page. The
// stored application check is also what says whether Argo CD is wired to the
// stand (models.Stand.ArgoConnected), which is what the orders of a stand
// that is not wired yet are told they are waiting for.

// standChecksState is the background round's own clock.
type standChecksState struct {
	mu   sync.Mutex
	last time.Time
}

// StandChecksSummary is one stand on the status page: the stand, the worst
// of its stored verdicts, and the verdicts themselves.
type StandChecksSummary struct {
	Stand   *models.Stand        `json:"stand"`
	Worst   string               `json:"worst"`
	Results []*models.StandCheck `json:"results"`
}

// CheckStand runs the checks of one stand now, stores what they found and
// returns it. The nesting check needs the other stands; the rest need the
// stand's live orders.
func (s *Service) CheckStand(ctx context.Context, st *models.Stand) ([]*models.StandCheck, error) {
	orders, err := s.store.ListRequests(ctx, store.RequestFilter{Admin: true, Stand: st.ID})
	if err != nil {
		return nil, err
	}
	all, err := s.store.ListStands(ctx)
	if err != nil {
		return nil, err
	}
	results := checks.Stand(ctx, s.StandGitLab, s.StandArgo, st, orders, s.gitops.ArgoProjectOf(st))
	if nest := checks.StandNesting(st, all); nest.Verdict != checks.VerdictSilent {
		results = append(results, nest)
	}
	now := time.Now()
	out := make([]*models.StandCheck, 0, len(results))
	for _, r := range results {
		out = append(out, &models.StandCheck{
			StandID: st.ID, ID: r.ID, Component: r.Component,
			Verdict: string(r.Verdict), Reason: r.Reason, Facts: r.Facts, CheckedAt: now,
		})
	}
	var connected *bool
	if c, known := checks.ArgoConnected(results); known {
		connected = &c
	}
	if err := s.store.SaveStandChecks(ctx, st.ID, out, connected); err != nil {
		return nil, err
	}
	st.CheckedAt = &now
	if connected != nil {
		st.ArgoConnected = *connected
	}
	return out, nil
}

// RunStandChecks is the background round: every stand, once per interval.
// It rides the poller, which ticks far more often, so most calls return at
// once. An interval of zero turns the round off.
func (s *Service) RunStandChecks(ctx context.Context) error {
	if s.StandChecksInterval <= 0 {
		return nil
	}
	s.standChecks.mu.Lock()
	due := time.Since(s.standChecks.last) >= s.StandChecksInterval
	if due {
		s.standChecks.last = time.Now()
	}
	s.standChecks.mu.Unlock()
	if !due {
		return nil
	}
	stands, err := s.store.ListStands(ctx)
	if err != nil {
		return err
	}
	var first error
	for _, st := range stands {
		if _, err := s.CheckStand(ctx, st); err != nil {
			s.logger().Warn("stand checks failed", "stand", st.ID, "stand_name", st.Name, "err", err)
			if first == nil {
				first = err
			}
		}
	}
	return first
}

// StandChecksSummary is what the status page reads: every stand with its
// stored verdicts and the worst of them. Nothing is run here.
func (s *Service) StandChecksSummary(ctx context.Context) ([]StandChecksSummary, error) {
	stands, err := s.ListStands(ctx)
	if err != nil {
		return nil, err
	}
	all, err := s.store.ListAllStandChecks(ctx)
	if err != nil {
		return nil, err
	}
	byStand := map[string][]*models.StandCheck{}
	for _, c := range all {
		byStand[c.StandID] = append(byStand[c.StandID], c)
	}
	out := make([]StandChecksSummary, 0, len(stands))
	for _, st := range stands {
		results := byStand[st.ID]
		if results == nil {
			results = []*models.StandCheck{}
		}
		verdicts := make([]checks.Verdict, 0, len(results))
		for _, r := range results {
			verdicts = append(verdicts, checks.Verdict(r.Verdict))
		}
		worst := checks.VerdictUnknown // never checked: the portal has not looked
		if len(results) > 0 {
			worst = checks.Worst(verdicts...)
		}
		out = append(out, StandChecksSummary{Stand: st, Worst: string(worst), Results: results})
	}
	return out, nil
}
