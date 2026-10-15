package models

import "time"

// MaintenanceState is where the portal stands with planned maintenance. It is
// derived from the window and the clock, never stored: a window that was
// scheduled for ten o'clock is active at ten without anything having to flip it.
type MaintenanceState string

const (
	// MaintenanceOff: no window, the portal works as usual.
	MaintenanceOff MaintenanceState = "off"
	// MaintenanceScheduled: a window is announced and has not started yet.
	// Everybody works and sees when it starts.
	MaintenanceScheduled MaintenanceState = "scheduled"
	// MaintenanceActive: only platform admins get in.
	MaintenanceActive MaintenanceState = "active"
)

// MaintenanceWindow is the one planned maintenance the portal knows about. There
// is at most one: a second window while the first is still open is the first
// one moved, and that is what editing it does.
type MaintenanceWindow struct {
	// ID names this window across edits, so the notifications about it are
	// told apart from those about the next one.
	ID       string    `json:"id"`
	StartsAt time.Time `json:"starts_at"`
	// EndsAt is when the work is planned to finish; nil means nobody knows yet.
	// Moving it later is what "extended until" means.
	EndsAt *time.Time `json:"ends_at,omitempty"`
	// Message is what the people locked out read: what is going on, whom to ask.
	Message string `json:"message"`
	// PauseBackground stops the loops that write to GitLab, Argo CD and the
	// registry while the window is active.
	PauseBackground bool `json:"pause_background"`
	// AutoEnd ends the window at EndsAt by itself. Off, a window past its end
	// stays active and is reported as overdue until an admin ends or extends it.
	AutoEnd       bool      `json:"auto_end"`
	UpdatedBy     string    `json:"-"`
	UpdatedByName string    `json:"updated_by_name,omitempty"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// StateAt is the window's state at a moment. A nil window is off.
func (w *MaintenanceWindow) StateAt(now time.Time) MaintenanceState {
	switch {
	case w == nil:
		return MaintenanceOff
	case now.Before(w.StartsAt):
		return MaintenanceScheduled
	case w.AutoEnd && w.EndsAt != nil && !now.Before(*w.EndsAt):
		return MaintenanceOff
	default:
		return MaintenanceActive
	}
}

// OverdueAt reports an active window whose planned end has passed.
func (w *MaintenanceWindow) OverdueAt(now time.Time) bool {
	return w.StateAt(now) == MaintenanceActive && w.EndsAt != nil && !now.Before(*w.EndsAt)
}

// What happened to a window, as its history records it.
const (
	MaintenanceScheduledAction = "scheduled" // announced for later
	MaintenanceStartedAction   = "started"   // switched on at once
	MaintenanceChangedAction   = "changed"   // times, message or settings edited
	MaintenanceEndedAction     = "ended"     // ended by an admin
	MaintenanceCancelledAction = "cancelled" // called off before it started
	MaintenanceAutoEndedAction = "auto_ended"
)

// MaintenanceEvent is one line of the windows' history: who did what, and the
// times and message the window had after it.
type MaintenanceEvent struct {
	ID        int64      `json:"id"`
	WindowID  string     `json:"window_id"`
	Action    string     `json:"action"`
	Actor     string     `json:"-"`
	ActorName string     `json:"actor_name,omitempty"`
	StartsAt  *time.Time `json:"starts_at,omitempty"`
	EndsAt    *time.Time `json:"ends_at,omitempty"`
	Message   string     `json:"message,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}
