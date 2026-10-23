package models

import "time"

// StandJob is background work on one stand's orders: moving them to the
// stand's new mode. One runs at a time per stand; while it does, the stand's
// mode, layout and path stay as they are.
type StandJob struct {
	ID       string `json:"id"`
	StandID  string `json:"stand_id"`
	Kind     string `json:"kind"`
	FromMode string `json:"from_mode"`
	ToMode   string `json:"to_mode"`
	Status   string `json:"status"`
	// Total is how many orders the job has to move, Done how many are where
	// the new mode wants them, Waiting how many have a change open in GitLab
	// that the job is waiting on. Recounted on every pass. Skipped is what a
	// regeneration left alone: orders whose manifest in Git already matched.
	Total   int `json:"total"`
	Done    int `json:"done"`
	Waiting int `json:"waiting"`
	Skipped int `json:"skipped"`
	// Failures are the orders the job gave up on, with why. The job does not
	// retry them; a new job does.
	Failures []StandJobFailure `json:"failures"`
	// Handled is what a regeneration has already decided about, by order:
	// StandJobUpdated or StandJobSkipped. A regenerated order looks no
	// different from one not yet looked at once its change has merged, so the
	// job keeps its own record rather than reading Git again every pass.
	Handled    map[string]string `json:"-"`
	CreatedBy  string            `json:"created_by"`
	CreatedAt  time.Time         `json:"created_at"`
	FinishedAt *time.Time        `json:"finished_at,omitempty"`
}

// StandJobFailure is one order a job could not move. Reason is an identifier
// the front end words, Detail the upstream's own words when there are any.
type StandJobFailure struct {
	OrderID     string `json:"order_id"`
	ServiceName string `json:"service_name"`
	Reason      string `json:"reason"`
	Detail      string `json:"detail,omitempty"`
}

// Kinds and statuses of a stand job.
const (
	StandJobModeChange = "mode_change"
	// StandJobDelete deletes every order of the stand the ordinary way, then
	// the stand itself.
	StandJobDelete = "delete"
	// StandJobRegenerate writes every order's application.yaml again from the
	// stand's current settings, through the order's ordinary change, and
	// leaves alone the ones whose manifest in Git already matches.
	StandJobRegenerate = "regenerate"

	StandJobRunning = "running"
	StandJobDone    = "done"
	StandJobStopped = "stopped"

	// What a regeneration records against an order in Handled.
	StandJobUpdated = "updated" // a change with the new manifest was opened
	StandJobSkipped = "skipped" // the manifest in Git already matched
)
