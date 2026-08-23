// Package activity answers "who uses the portal": who is here now, who has been
// here, and what people have been doing.
//
// Nothing about it is an audit trail. Presence lives in the cache and is lost
// with it; the directory in Postgres is built from sign-ins, so it holds the
// people who have actually opened the portal and nobody else. What it is for is
// the overview: an admin who today has no way of telling a platform three teams
// live in from one nobody has opened in a month.
package activity

import (
	"context"
	"log/slog"
	"net/http"
	"sort"
	"sync"
	"time"

	"console/internal/auth"
	"console/internal/cache"
	"console/internal/store"
	"console/pkg/models"
)

const (
	// OnlineWindow is how long after a request a person still counts as here.
	// The portal has no "left" event - a browser tab is closed without telling
	// anyone - so presence is always "seen recently", and the window is what
	// "recently" means.
	OnlineWindow = 5 * time.Minute

	// touchInterval is the least time between two writes of one person's row.
	// Without it the directory would take an UPDATE on every request, which at
	// portal traffic is hundreds a minute for a table nobody reads that often.
	// The cost of the throttle is that last_seen can be up to this far behind,
	// which is invisible next to a five-minute presence window.
	touchInterval = 5 * time.Minute

	// presenceKey is the single set of everyone seen recently; touchKey prefixes
	// the per-person flag that holds the throttle open.
	presenceKey = "presence:users"
	touchKey    = "presence:touched:"

	// recordTimeout bounds one recording. It runs on a context of its own (the
	// request's is gone by then), and without a deadline a wedged cache would
	// leak a goroutine per request.
	recordTimeout = 5 * time.Second
)

// Recorder writes what the middleware sees and reads the picture back.
type Recorder struct {
	store    store.Store
	cache    cache.Cache
	presence cache.Presence
	log      *slog.Logger
	now      func() time.Time
	// inflight counts recordings that outlive the response they came from (see
	// Middleware), so a caller can wait for them to land.
	inflight sync.WaitGroup
}

// New builds a recorder. presence may be nil when the cache backend has no
// presence support: the directory still fills up, and "who is online" answers
// empty rather than failing.
func New(st store.Store, c cache.Cache, p cache.Presence, log *slog.Logger) *Recorder {
	return &Recorder{store: st, cache: c, presence: p, log: log, now: time.Now}
}

func (r *Recorder) logger() *slog.Logger {
	if r.log != nil {
		return r.log
	}
	return slog.Default()
}

// Middleware records the caller of every authenticated request. It must sit
// after auth.Middleware, which is where the user comes from; a request without
// one passes straight through (an unauthenticated caller is nobody to record).
//
// The recording happens off the request's own goroutine and on a context of its
// own: a person is not made to wait on a cache round trip and an occasional
// UPDATE to see the page they asked for, and the write must survive the
// response being sent. The same reason it is detached is why it never reports
// failure to the caller - being unable to note that somebody was here is not a
// reason to refuse them the page - so it logs instead.
func (r *Recorder) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if u := auth.UserFrom(req.Context()); u != nil {
			ctx := context.WithoutCancel(req.Context())
			r.inflight.Add(1)
			go func() {
				defer r.inflight.Done()
				ctx, cancel := context.WithTimeout(ctx, recordTimeout)
				defer cancel()
				r.Touch(ctx, u)
			}()
		}
		next.ServeHTTP(w, req)
	})
}

// Wait blocks until the recordings started so far have finished. For tests, and
// for anything that wants the writes to land before it tears the process down.
func (r *Recorder) Wait() { r.inflight.Wait() }

// Touch records one appearance: presence every time, the directory row at most
// once per touchInterval.
func (r *Recorder) Touch(ctx context.Context, u *models.User) {
	if u == nil || u.Subject == "" {
		return
	}
	now := r.now()
	if r.presence != nil {
		if err := r.presence.Touch(ctx, presenceKey, u.Subject, now); err != nil {
			r.logger().Warn("presence not recorded", "actor", u.Subject, "err", err)
		}
	}
	if !r.claimTouch(ctx, u.Subject) {
		return
	}
	pu := &models.PlatformUser{
		Subject: u.Subject, Email: u.Email, Username: u.Username, Name: u.Name,
		Teams: u.Teams, Role: u.Role, LastSeen: now,
	}
	if err := r.store.TouchUser(ctx, pu); err != nil {
		r.logger().Warn("user directory not updated", "actor", u.Subject, "err", err)
	}
}

// claimTouch reports whether this appearance is the one that gets to write the
// directory row, and holds the throttle open for the next touchInterval. A
// cache that cannot answer lets the write through: a directory that lags is
// worse than an extra UPDATE.
func (r *Recorder) claimTouch(ctx context.Context, subject string) bool {
	key := touchKey + subject
	if _, ok, err := r.cache.Get(ctx, key); err == nil && ok {
		return false
	}
	if err := r.cache.Set(ctx, key, []byte("1"), touchInterval); err != nil {
		r.logger().Debug("touch throttle not set", "actor", subject, "err", err)
	}
	return true
}

// Online is who has been seen inside the window, most recent first.
func (r *Recorder) Online(ctx context.Context) ([]cache.Seen, error) {
	if r.presence == nil {
		return nil, nil
	}
	return r.presence.Since(ctx, presenceKey, r.now().Add(-OnlineWindow))
}

// Prune drops presence entries that have fallen out of the window. Presence is
// the one thing here that would otherwise grow forever: every person who has
// ever signed in, kept for good in a set that is only ever read for the last
// five minutes. Called from the metrics refresher, not from the request path.
func (r *Recorder) Prune(ctx context.Context) error {
	if r.presence == nil {
		return nil
	}
	return r.presence.PruneBefore(ctx, presenceKey, r.now().Add(-OnlineWindow))
}

// Totals is the top row of the activity page.
type Totals struct {
	Users     int `json:"users"`
	Online    int `json:"online"`
	Active24h int `json:"active_24h"`
	Active7d  int `json:"active_7d"`
	Teams     int `json:"teams"`
}

// Overview is the whole picture in one read: the directory, who is in it right
// now, the teams it adds up to, and the totals. The metrics refresher and the
// admin page both work from this, so a number on the page and the same number
// on a dashboard cannot be computed two different ways.
type Overview struct {
	Totals Totals                 `json:"totals"`
	Online []*models.PlatformUser `json:"online"`
	Users  []*models.PlatformUser `json:"users"`
	Teams  []*models.TeamActivity `json:"teams"`
}

// Overview reads the directory and folds presence into it. The directory is
// read whole: it holds everyone who has ever signed in, which is the size of
// the company, and every part of the answer needs a total over all of it.
func (r *Recorder) Overview(ctx context.Context) (*Overview, error) {
	users, err := r.store.ListUsers(ctx)
	if err != nil {
		return nil, err
	}
	seen, err := r.Online(ctx)
	if err != nil {
		// Presence is the volatile half. A cache that is down should cost the
		// page its "who is here now", not the whole page.
		r.logger().Warn("presence unavailable", "err", err)
		seen = nil
	}
	now := r.now()
	online := make(map[string]time.Time, len(seen))
	for _, s := range seen {
		online[s.Member] = s.At
	}

	ov := &Overview{Users: users, Online: []*models.PlatformUser{}, Teams: []*models.TeamActivity{}}
	teams := map[string]*models.TeamActivity{}
	for _, u := range users {
		if at, ok := online[u.Subject]; ok {
			u.Online = true
			u.SeenAgo = int64(now.Sub(at) / time.Second)
			// Presence is the fresher of the two facts: the directory row is
			// written at most once every few minutes, presence on every request.
			// Without this the same person reads as "только что" in one place
			// and "5 мин назад" in another, on the same screen.
			if at.After(u.LastSeen) {
				u.LastSeen = at
			}
			ov.Online = append(ov.Online, u)
		}
		active24 := now.Sub(u.LastSeen) <= 24*time.Hour
		if active24 {
			ov.Totals.Active24h++
		}
		if now.Sub(u.LastSeen) <= 7*24*time.Hour {
			ov.Totals.Active7d++
		}
		for _, name := range u.Teams {
			t, ok := teams[name]
			if !ok {
				t = &models.TeamActivity{Team: name}
				teams[name] = t
			}
			t.Members++
			if u.Online {
				t.Online++
			}
			if active24 {
				t.Active24h++
			}
			t.People = append(t.People, u)
		}
	}
	// Someone whose presence is still warm but whose directory row has been
	// removed is counted, not dropped: the number of people here has to match
	// what the gauge says, and a name the portal cannot produce is better shown
	// as a missing name than as a missing person.
	for _, s := range seen {
		if !hasSubject(users, s.Member) {
			ov.Online = append(ov.Online, &models.PlatformUser{
				Subject: s.Member, Teams: []string{}, LastSeen: s.At,
				Online: true, SeenAgo: int64(now.Sub(s.At) / time.Second),
			})
		}
	}
	sort.Slice(ov.Online, func(i, j int) bool { return ov.Online[i].SeenAgo < ov.Online[j].SeenAgo })

	for _, t := range teams {
		sort.Slice(t.People, func(i, j int) bool { return t.People[i].LastSeen.After(t.People[j].LastSeen) })
		ov.Teams = append(ov.Teams, t)
	}
	sort.Slice(ov.Teams, func(i, j int) bool {
		if ov.Teams[i].Members != ov.Teams[j].Members {
			return ov.Teams[i].Members > ov.Teams[j].Members
		}
		return ov.Teams[i].Team < ov.Teams[j].Team
	})

	ov.Totals.Users = len(users)
	ov.Totals.Online = len(ov.Online)
	ov.Totals.Teams = len(ov.Teams)
	return ov, nil
}

func hasSubject(users []*models.PlatformUser, subject string) bool {
	for _, u := range users {
		if u.Subject == subject {
			return true
		}
	}
	return false
}
