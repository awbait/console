// Package maintenance is the portal's planned maintenance: one window that an
// admin announces, extends and ends, during which only platform admins get in
// and, optionally, the background loops that write to GitLab, Argo CD and the
// registry stand still.
//
// The window lives in the database, so every replica sees the same one. The
// state (announced, on, over) is never stored: it follows from the window's
// times and the clock, so a window planned for ten is on at ten on every
// replica without anything having to flip it. What does have to happen at a
// moment - a reminder before the start, the end of a window that ends by
// itself, a word to the admins about one running late - is done by Run, on the
// replica that runs the background loops.
package maintenance

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"console/internal/notify"
	"console/internal/observability"
	"console/internal/store"
	"console/pkg/models"
	"github.com/google/uuid"
)

const (
	// cacheTTL is how long a replica trusts the window it read. Every API
	// request asks, so it is cached; a change made on another replica arrives
	// within this time.
	cacheTTL = 5 * time.Second
	// remindBefore is how long before the start the reminder goes out.
	remindBefore = 15 * time.Minute
	// tickInterval is how often Run looks at the window.
	tickInterval = 30 * time.Second
	// MaxMessage bounds the text shown to the people locked out, in characters.
	MaxMessage = 2000
	// HistoryLimit is how many events of the history the admin page gets.
	HistoryLimit = 50
)

// Validation codes. The admin page words them: the text a person reads lives
// in the interface, the API says which rule broke.
const (
	CodeTooLong     = "too_long"     // message: longer than MaxMessage
	CodeBeforeStart = "before_start" // ends_at: not after the start
	CodeInPast      = "in_past"      // ends_at: already gone
	CodeNeedsEnd    = "needs_end"    // auto_end: there is no end to end at
)

// ValidationError is a rule an input broke, on one field.
type ValidationError struct {
	Field string
	Code  string
}

func (e *ValidationError) Error() string { return "maintenance: " + e.Field + ": " + e.Code }

// Status is the maintenance as it stands now.
type Status struct {
	State models.MaintenanceState `json:"state"`
	// Window is nil when the state is off and nothing is forced.
	Window *models.MaintenanceWindow `json:"window,omitempty"`
	// Overdue: on, and past the planned end.
	Overdue bool `json:"overdue,omitempty"`
	// Forced: switched on by MAINTENANCE_FORCE, whatever the database says.
	Forced bool `json:"forced,omitempty"`
}

// Public is the part of the status anybody may read, signed in or not: the
// sign-in screen and the screen that locks people out are built from it. Who
// changed the window and how it is set up stay on the admin page.
type Public struct {
	State    models.MaintenanceState `json:"state"`
	StartsAt *time.Time              `json:"starts_at,omitempty"`
	EndsAt   *time.Time              `json:"ends_at,omitempty"`
	Message  string                  `json:"message,omitempty"`
	Overdue  bool                    `json:"overdue,omitempty"`
}

// Public strips the status down to what anybody may read.
func (st Status) Public() Public {
	p := Public{State: st.State, Overdue: st.Overdue}
	if w := st.Window; w != nil {
		start := w.StartsAt
		p.StartsAt, p.EndsAt, p.Message = &start, w.EndsAt, w.Message
	}
	return p
}

// Input is what an admin sets. A nil start is now; a start in the past is now
// as well. The start of a window already on cannot move: it has happened.
type Input struct {
	StartsAt        *time.Time `json:"starts_at"`
	EndsAt          *time.Time `json:"ends_at"`
	Message         string     `json:"message"`
	PauseBackground bool       `json:"pause_background"`
	AutoEnd         bool       `json:"auto_end"`
}

// Service owns the window. Build it with New.
type Service struct {
	store  store.Store
	notify *notify.Service
	// reconcile asks for a sweep of the background loops now. Called when a
	// window that held them still stops holding them, so the work that waited
	// does not wait for the next tick as well. Nil does nothing.
	reconcile func(reason string)
	// force is MAINTENANCE_FORCE: maintenance on, loops paused, whatever the
	// database holds - for when the database is what is being worked on.
	force bool
	log   *slog.Logger
	now   func() time.Time

	mu       sync.Mutex
	cached   *models.MaintenanceWindow
	cachedAt time.Time
	loaded   bool
	// readFailing marks the edge of a failing read, so it is logged once.
	readFailing bool
}

// New builds the service. notify and reconcile may be nil.
func New(st store.Store, n *notify.Service, reconcile func(string), force bool, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{store: st, notify: n, reconcile: reconcile, force: force, log: log, now: time.Now}
}

// window returns the stored window, from the cache when it is fresh. A read
// that fails keeps the last window known, and nil if there never was one: the
// portal stays open when it cannot tell, because a closed portal nobody can
// switch back on is worse than maintenance that started a little late.
func (s *Service) window(ctx context.Context) *models.MaintenanceWindow {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.loaded && s.now().Sub(s.cachedAt) < cacheTTL {
		return s.cached
	}
	w, err := s.store.GetMaintenance(ctx)
	switch {
	case errors.Is(err, models.ErrNotFound):
		w = nil
	case err != nil:
		if !s.readFailing {
			s.log.Warn("maintenance read failing", "err", err)
			s.readFailing = true
		}
		return s.cached
	}
	if s.readFailing {
		s.log.Info("maintenance read recovered")
		s.readFailing = false
	}
	s.cached, s.cachedAt, s.loaded = w, s.now(), true
	return w
}

// forget drops the cached window, so this replica sees its own change at once.
func (s *Service) forget() {
	s.mu.Lock()
	s.loaded = false
	s.mu.Unlock()
}

// Status is the maintenance as it stands now.
func (s *Service) Status(ctx context.Context) Status {
	w := s.window(ctx)
	now := s.now()
	st := Status{State: w.StateAt(now), Overdue: w.OverdueAt(now)}
	if st.State != models.MaintenanceOff {
		st.Window = w
	}
	if s.force {
		st.State, st.Forced = models.MaintenanceActive, true
		if w != nil {
			st.Window = w
		}
	}
	observability.SetMaintenanceActive(st.State == models.MaintenanceActive)
	return st
}

// Blocks reports whether this person is turned away right now: maintenance is
// on and they are not a platform admin.
func (s *Service) Blocks(ctx context.Context, u *models.User) bool {
	if u != nil && u.IsAdmin() {
		return false
	}
	return s.Status(ctx).State == models.MaintenanceActive
}

// PausesBackground reports whether the loops that write to the outside world
// should stand still right now.
func (s *Service) PausesBackground(ctx context.Context) bool {
	st := s.Status(ctx)
	if st.State != models.MaintenanceActive {
		return false
	}
	return st.Forced || (st.Window != nil && st.Window.PauseBackground)
}

// History is the windows' history, newest first.
func (s *Service) History(ctx context.Context) ([]*models.MaintenanceEvent, error) {
	return s.store.ListMaintenanceEvents(ctx, HistoryLimit)
}

// Set announces a window, switches one on, or changes the one there is.
func (s *Service) Set(ctx context.Context, u *models.User, in Input) (Status, error) {
	now := s.now()
	cur, err := s.stored(ctx)
	if err != nil {
		return Status{}, err
	}
	// A window that ended by itself and has not been cleared yet is over: the
	// new input is a new window, and the old one gets its end recorded first.
	if cur != nil && cur.StateAt(now) == models.MaintenanceOff {
		if err := s.end(ctx, cur, nil, models.MaintenanceAutoEndedAction); err != nil && !errors.Is(err, models.ErrNotFound) {
			return Status{}, err
		}
		cur = nil
	}

	msg := strings.TrimSpace(in.Message)
	if utf8.RuneCountInString(msg) > MaxMessage {
		return Status{}, &ValidationError{Field: "message", Code: CodeTooLong}
	}
	start := now
	switch {
	case cur != nil && cur.StateAt(now) == models.MaintenanceActive:
		start = cur.StartsAt
	case in.StartsAt != nil && in.StartsAt.After(now):
		start = *in.StartsAt
	}
	var end *time.Time
	if in.EndsAt != nil {
		e := *in.EndsAt
		if !e.After(start) {
			return Status{}, &ValidationError{Field: "ends_at", Code: CodeBeforeStart}
		}
		if !e.After(now) {
			return Status{}, &ValidationError{Field: "ends_at", Code: CodeInPast}
		}
		end = &e
	}
	if in.AutoEnd && end == nil {
		return Status{}, &ValidationError{Field: "auto_end", Code: CodeNeedsEnd}
	}

	w := &models.MaintenanceWindow{
		StartsAt: start, EndsAt: end, Message: msg,
		PauseBackground: in.PauseBackground, AutoEnd: in.AutoEnd,
		UpdatedBy: u.Subject, UpdatedByName: u.Name,
	}
	action := models.MaintenanceChangedAction
	if cur != nil {
		w.ID = cur.ID
	} else {
		w.ID = uuid.Must(uuid.NewV7()).String()
		action = models.MaintenanceScheduledAction
		if !start.After(now) {
			action = models.MaintenanceStartedAction
		}
	}
	moved := cur != nil && (!cur.StartsAt.Equal(w.StartsAt) || !sameTime(cur.EndsAt, w.EndsAt))

	err = s.store.Tx(ctx, func(tx store.Store) error {
		if err := tx.SaveMaintenance(ctx, w); err != nil {
			return err
		}
		if err := tx.AddMaintenanceEvent(ctx, eventOf(w, action, u)); err != nil {
			return err
		}
		if s.notify != nil {
			switch {
			case cur == nil:
				s.notify.MaintenanceAnnounced(ctx, tx, w, action == models.MaintenanceStartedAction, u)
			case moved:
				s.notify.MaintenanceChanged(ctx, tx, w, u)
			}
		}
		return nil
	})
	if err != nil {
		return Status{}, err
	}
	s.forget()
	s.log.Info("maintenance set", "action", action, "window", w.ID, "actor", u.Subject,
		"starts_at", w.StartsAt, "pause_background", w.PauseBackground, "auto_end", w.AutoEnd)
	// Loops that were held and are not any more go back to work at once.
	if holds(cur, now) && !holds(w, now) {
		s.sweep("maintenance no longer pauses the background loops")
	}
	return s.Status(ctx), nil
}

// End ends the window now, or calls it off if it has not started. ErrNotFound
// when there is none.
func (s *Service) End(ctx context.Context, u *models.User) (Status, error) {
	cur, err := s.stored(ctx)
	if err != nil {
		return Status{}, err
	}
	if cur == nil {
		return Status{}, models.ErrNotFound
	}
	action := models.MaintenanceEndedAction
	switch cur.StateAt(s.now()) {
	case models.MaintenanceScheduled:
		action = models.MaintenanceCancelledAction
	case models.MaintenanceOff:
		action = models.MaintenanceAutoEndedAction // it was over already; record it as such
		u = nil
	}
	if err := s.end(ctx, cur, u, action); err != nil {
		return Status{}, err
	}
	return s.Status(ctx), nil
}

// end clears the window and records why, in one transaction with its history
// line and the word to everyone. u is nil when the window ended by itself.
func (s *Service) end(ctx context.Context, w *models.MaintenanceWindow, u *models.User, action string) error {
	err := s.store.Tx(ctx, func(tx store.Store) error {
		if err := tx.ClearMaintenance(ctx, w.ID); err != nil {
			return err
		}
		if err := tx.AddMaintenanceEvent(ctx, eventOf(w, action, u)); err != nil {
			return err
		}
		if s.notify != nil {
			s.notify.MaintenanceEnded(ctx, tx, w, action == models.MaintenanceCancelledAction, u)
		}
		return nil
	})
	if err != nil {
		return err
	}
	s.forget()
	actor := ""
	if u != nil {
		actor = u.Subject
	}
	s.log.Info("maintenance ended", "action", action, "window", w.ID, "actor", actor)
	if action != models.MaintenanceCancelledAction && w.PauseBackground {
		s.sweep("maintenance ended")
	}
	return nil
}

// Tick does what has to happen at a moment: ends a window that ends by itself,
// reminds everyone shortly before a start, tells the admins about a window past
// its planned end. Each of these is safe to repeat: the notifications are
// deduplicated and the end clears only the window it was about.
func (s *Service) Tick(ctx context.Context) error {
	w, err := s.stored(ctx)
	if err != nil || w == nil {
		return err
	}
	now := s.now()
	switch {
	case w.StateAt(now) == models.MaintenanceOff:
		if err := s.end(ctx, w, nil, models.MaintenanceAutoEndedAction); err != nil && !errors.Is(err, models.ErrNotFound) {
			return err
		}
	case w.StateAt(now) == models.MaintenanceScheduled:
		// Only a window saved before the reminder moment: one announced or moved
		// inside it was news a minute ago, and the reminder would repeat it.
		remindAt := w.StartsAt.Add(-remindBefore)
		if !now.Before(remindAt) && w.UpdatedAt.Before(remindAt) && s.notify != nil {
			s.notify.MaintenanceSoon(ctx, nil, w)
		}
	case w.OverdueAt(now):
		if s.notify != nil {
			s.notify.MaintenanceOverdue(ctx, nil, w)
		}
	}
	return nil
}

// Run calls Tick on an interval while leads says this replica runs the
// background loops. Its own clock rather than the poller's: in webhook-only
// mode the poller does not tick at all, and a window still has to end on time.
// Blocks until ctx is cancelled.
func (s *Service) Run(ctx context.Context, leads func() bool) {
	t := time.NewTicker(tickInterval)
	defer t.Stop()
	failing := false
	for {
		if leads == nil || leads() {
			err := s.Tick(ctx)
			switch {
			case err != nil && !failing:
				s.log.Warn("maintenance tick failing", "err", err)
			case err == nil && failing:
				s.log.Info("maintenance tick recovered")
			}
			failing = err != nil
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// stored reads the window past the cache: a write decides on what is there now.
func (s *Service) stored(ctx context.Context) (*models.MaintenanceWindow, error) {
	w, err := s.store.GetMaintenance(ctx)
	if errors.Is(err, models.ErrNotFound) {
		return nil, nil
	}
	return w, err
}

func (s *Service) sweep(reason string) {
	if s.reconcile != nil {
		s.reconcile(reason)
	}
}

// holds reports whether a window keeps the background loops still at a moment.
func holds(w *models.MaintenanceWindow, now time.Time) bool {
	return w != nil && w.PauseBackground && w.StateAt(now) == models.MaintenanceActive
}

func sameTime(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Equal(*b)
}

func eventOf(w *models.MaintenanceWindow, action string, u *models.User) *models.MaintenanceEvent {
	start := w.StartsAt
	e := &models.MaintenanceEvent{
		WindowID: w.ID, Action: action, StartsAt: &start, EndsAt: w.EndsAt, Message: w.Message,
	}
	if u != nil {
		e.Actor, e.ActorName = u.Subject, u.Name
	}
	return e
}
