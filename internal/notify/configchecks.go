package notify

import (
	"context"
	"errors"
	"strconv"
	"sync"

	"console/internal/checks"
	"console/pkg/models"
)

// The configuration checks say what is wrong on the page that shows them, and
// that is enough for what is wrong from the day it was deployed. It is not
// enough for what breaks by itself: nothing brings anybody to that page on the
// day a token expires or GitLab switches a webhook off, and the way it is
// learnt instead is from a person whose order did not go through.
//
// So the few verdicts that mean "this broke on its own" are announced to the
// platform team, and called off when they come back (see checks.Notable for
// which, and why the list is short).

// configSubject is what a check is called in the notifications about it. One
// subject per check: the last notification about it is the state, which is what
// makes a restart quiet and a second breakage news again.
func configSubject(check string) string { return "config:" + check }

// ConfigWatch turns rounds of configuration checks into notifications. It is
// the checks.Announcer the runner calls after every round.
type ConfigWatch struct {
	s *Service

	mu sync.Mutex
	// announced is what the platform team was last told about each check: the
	// key of a problem still standing, or "" for a check with nothing
	// outstanding. A check that is not in the map is one this process has not
	// asked about yet - the answer is in the notifications themselves, and is
	// read once, on the first round after a start.
	announced map[string]string
}

// ConfigWatch builds the watcher over this service.
func (s *Service) ConfigWatch() *ConfigWatch {
	return &ConfigWatch{s: s, announced: make(map[string]string)}
}

// Round compares what every check now says with what was last said about it and
// writes the difference: a problem that has just appeared, or a problem that is
// over. A verdict that has not changed says nothing - the round comes every ten
// minutes, and a broken token stays broken for days.
func (w *ConfigWatch) Round(ctx context.Context, results []checks.CheckResult) {
	if w == nil || w.s == nil {
		return
	}
	for _, res := range results {
		ev, notable := checks.Notable(res)
		switch {
		case notable:
			last, ok := w.outstanding(ctx, res.ID)
			if !ok || last == ev.Key {
				continue
			}
			w.s.configCheckFailed(ctx, ev)
			w.remember(res.ID, ev.Key)
		case recovered(res):
			last, ok := w.outstanding(ctx, res.ID)
			if !ok || last == "" {
				continue
			}
			w.s.configCheckRecovered(ctx, res.ID)
			w.remember(res.ID, "")
		}
	}
}

// recovered reports that a check is no longer in a state anything can be
// announced about. Unknown does not count: the upstream did not answer, so the
// check did not run, and "we could not look" must never be read as "it is
// fixed". Neither does a failure of its own - the announced problem may be
// gone, but calling that an all-clear while the check is still red would be a
// message that contradicts the page it links to.
func recovered(res checks.CheckResult) bool {
	return res.Verdict != checks.VerdictFail && res.Verdict != checks.VerdictUnknown
}

// outstanding is the key of the problem the platform team is currently waiting
// on for this check, "" when there is none. ok is false when the store could not
// answer: then the round leaves this check alone rather than guessing, and asks
// again in ten minutes.
func (w *ConfigWatch) outstanding(ctx context.Context, check string) (string, bool) {
	w.mu.Lock()
	key, known := w.announced[check]
	w.mu.Unlock()
	if known {
		return key, true
	}
	key, err := w.lastAnnounced(ctx, check)
	if err != nil {
		w.s.logger().Warn("configuration check history not read", "check", check, "err", err)
		return "", false
	}
	w.remember(check, key)
	return key, true
}

// lastAnnounced reads what was last said about a check out of the notifications
// themselves, so a restart does not repeat a problem already reported and does
// not swallow the all-clear for one reported before it.
func (w *ConfigWatch) lastAnnounced(ctx context.Context, check string) (string, error) {
	n, err := w.s.store.LatestNotification(ctx, models.SubjectPlatform, configSubject(check))
	switch {
	case errors.Is(err, models.ErrNotFound):
		return "", nil
	case err != nil:
		return "", err
	case n.Kind != models.NotifyConfigCheckFailed:
		return "", nil // the last word on it was the all-clear
	}
	key, _ := n.Payload["event"].(string)
	return key, nil
}

func (w *ConfigWatch) remember(check, key string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.announced[check] = key
}

// configCheckFailed: something the portal is wired to has broken without anyone
// touching the portal. Addressed to the admin role - it is fixed in GitLab,
// Harbor or Argo CD, and only the platform team can get there.
func (s *Service) configCheckFailed(ctx context.Context, ev checks.Event) {
	payload := map[string]any{
		"check":  ev.Check,
		"reason": ev.Reason,
		// event is the key the next round compares against, kept in the payload
		// because the notification is where the state lives.
		"event": ev.Key,
	}
	if days, err := strconv.Atoi(ev.Facts["days_left"]); err == nil {
		payload["days_left"] = days
	}
	s.logger().Warn("configuration check announced", "check", ev.Check, "reason", ev.Reason)
	s.Send(ctx, nil, Notification{
		Kind:        models.NotifyConfigCheckFailed,
		SubjectType: models.SubjectPlatform,
		SubjectID:   configSubject(ev.Check),
		Audience:    models.AudienceRole,
		AudienceKey: string(models.RoleAdmin),
		Payload:     payload,
		Level:       models.LevelAttention,
		// No deduplication key: the same problem is news again once it has been
		// fixed and has come back, so there is no key that both stops the
		// repeats and lets the second time through. What stops the repeats is
		// the state - the last notification about this check - which is read
		// back at startup and kept in memory after that.
		DedupKey: "",
	})
}

// configCheckRecovered: the problem announced about a check is over. Sent to
// whoever was told about it, because a report of a fault without a report of
// its end leaves the reader unable to tell whether there is still anything to
// do.
func (s *Service) configCheckRecovered(ctx context.Context, check string) {
	s.logger().Info("configuration check recovered", "check", check)
	s.Send(ctx, nil, Notification{
		Kind:        models.NotifyConfigCheckRecovered,
		SubjectType: models.SubjectPlatform,
		SubjectID:   configSubject(check),
		Audience:    models.AudienceRole,
		AudienceKey: string(models.RoleAdmin),
		Payload:     map[string]any{"check": check},
		Level:       models.LevelInfo,
	})
}
