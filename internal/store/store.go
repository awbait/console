// Package store defines the persistence port and its implementations
// (Postgres for production, in-memory for tests/local).
package store

import (
	"context"
	"time"

	"console/pkg/models"
)

// RequestFilter narrows ListRequests. Teams scopes visibility to the caller's
// teams (empty Teams + Admin=true means "all teams").
type RequestFilter struct {
	Teams          []string
	Admin          bool
	Team           string
	Status         models.RequestStatus
	Chart          string
	IncludeDeleted bool
}

// NotificationFilter is who is reading, which is what decides both what is
// visible and what counts as unread. Teams and Role come from the session, so a
// person who leaves a team stops seeing its notifications without anything
// being rewritten.
type NotificationFilter struct {
	Subject string
	Teams   []string
	Role    string
	// Before pages backwards through the feed; zero means "from the newest".
	Before time.Time
	Limit  int
}

// PublicationFilter narrows ListPublications.
type PublicationFilter struct {
	Status models.PublicationStatus
	Team   string // owner_team
	Chart  string // chart_name
}

// Store is the portal's persistence port.
type Store interface {
	// Requests
	CreateRequest(ctx context.Context, r *models.Request) error // ErrConflict on dup
	GetRequest(ctx context.Context, id string) (*models.Request, error)
	ListRequests(ctx context.Context, f RequestFilter) ([]*models.Request, error)
	UpdateRequest(ctx context.Context, r *models.Request) error // optimistic lock; ErrStaleVersion
	// ListActive returns non-deleted requests in non-terminal states (for the poller).
	ListActive(ctx context.Context) ([]*models.Request, error)
	// SetDrift updates only the drift flag/detail (no optimistic-lock bump), so the
	// poller can record drift without racing concurrent user edits.
	SetDrift(ctx context.Context, id string, drifted bool, detail string) error

	// Merge requests
	AddMR(ctx context.Context, mr *models.RequestMR) error
	UpdateMR(ctx context.Context, mr *models.RequestMR) error
	ListMRs(ctx context.Context, requestID string) ([]*models.RequestMR, error)
	// GetOpenMR returns the single open MR for a request, or ErrNotFound.
	GetOpenMR(ctx context.Context, requestID string) (*models.RequestMR, error)

	// Events / audit
	AddEvent(ctx context.Context, e *models.RequestEvent) error
	ListEvents(ctx context.Context, requestID string) ([]*models.RequestEvent, error)

	// Notifications
	// AddNotification stores one notification. A row whose DedupKey is already
	// present is dropped silently: the background loop revisits the same order
	// every few seconds and only the first pass is news.
	AddNotification(ctx context.Context, n *models.Notification) error
	// ListNotifications returns what the reader may see, newest first, older
	// than `before` when it is non-zero. Each row carries its own read flag.
	ListNotifications(ctx context.Context, f NotificationFilter) ([]*models.Notification, error)
	// CountUnread is the number for the bell.
	CountUnread(ctx context.Context, f NotificationFilter) (int, error)
	// MarkRead marks one notification read by this reader. Marking a
	// notification the reader cannot see is not an error, only a no-op.
	MarkRead(ctx context.Context, id, subject string) error
	// MarkAllRead moves the reader's cursor to now: everything already sent is
	// read, without a row per notification.
	MarkAllRead(ctx context.Context, subject string) error
	// DeleteReadNotificationsBefore drops notifications everyone concerned has
	// read and that are older than the cutoff. Returns how many went.
	DeleteReadNotificationsBefore(ctx context.Context, cutoff time.Time) (int, error)
	// LatestNotification returns the newest notification about one subject,
	// whatever its audience, or ErrNotFound.
	//
	// It is how a loop that announces a state and then calls it off finds out
	// what it last said: the notification is the record, so nothing has to be
	// kept in memory to stay quiet across a restart. Read on the first round
	// after a restart and not again, so it costs a query per subject per
	// process, and the answer may be gone once the retention sweep has taken it.
	LatestNotification(ctx context.Context, subjectType, subjectID string) (*models.Notification, error)

	// Platform users: the portal's own directory, built from who signs in.
	// TouchUser creates the row on the first visit and refreshes name, teams,
	// role and last_seen on the ones after, counting one visit per call. It is
	// called at most once every few minutes per person (see internal/activity),
	// never once per request.
	TouchUser(ctx context.Context, u *models.PlatformUser) error
	// ListUsers returns the whole directory, most recently seen first. No
	// paging: it holds everyone who has ever signed in, which is the size of the
	// company, and every reader of it (the activity page, the gauges) needs the
	// totals anyway.
	ListUsers(ctx context.Context) ([]*models.PlatformUser, error)
	// ListActivity returns the newest events of both journals (orders and
	// publications) as one stream, newest first. Only what people did: events
	// the platform wrote by itself are left out (see models.IsSystemActor).
	ListActivity(ctx context.Context, limit int) ([]*models.ActivityEvent, error)
	// CountActivity counts the same stream since a moment, grouped by event
	// type and team. For the gauges, which need totals rather than rows.
	CountActivity(ctx context.Context, since time.Time) ([]*models.ActivityCount, error)

	// Catalog categories
	CreateCategory(ctx context.Context, c *models.Category) error // ErrConflict on dup id
	UpdateCategory(ctx context.Context, c *models.Category) error
	DeleteCategory(ctx context.Context, id string) error // ErrConflict when referenced by publications
	ListCategories(ctx context.Context) ([]*models.Category, error)

	// Chart publications (catalog metadata + view documents)
	CreatePublication(ctx context.Context, p *models.ChartPublication) error // ErrConflict on dup chart
	GetPublication(ctx context.Context, id string) (*models.ChartPublication, error)
	GetPublicationByChart(ctx context.Context, project, name string) (*models.ChartPublication, error)
	ListPublications(ctx context.Context, f PublicationFilter) ([]*models.ChartPublication, error)
	UpdatePublication(ctx context.Context, p *models.ChartPublication) error // optimistic lock; ErrStaleVersion

	AddPublicationEvent(ctx context.Context, e *models.PublicationEvent) error
	ListPublicationEvents(ctx context.Context, publicationID string) ([]*models.PublicationEvent, error)

	// Publication versions (1:N under a publication). A version carries its own
	// view document and approval status; orderable is the per-version allowlist.
	ListVersions(ctx context.Context, publicationID string) ([]*models.PublicationVersion, error)
	GetVersion(ctx context.Context, publicationID, chartVersion string) (*models.PublicationVersion, error)
	// UpsertVersion creates the (publication_id, chart_version) row or updates the
	// existing one (bumping its optimistic-lock version). It refreshes the passed
	// struct's ID/Version/timestamps from the stored row.
	UpsertVersion(ctx context.Context, v *models.PublicationVersion) error
	// SetOrderable flips a single version's allowlist flag without a version bump.
	SetOrderable(ctx context.Context, versionID string, orderable bool) error
	// SetRecommended sets the publication's recommended_version (no version bump).
	SetRecommended(ctx context.Context, publicationID, chartVersion string) error

	// Tx runs fn within a single transaction: every store call on the Store given
	// to fn commits or rolls back atomically. Used to keep a status transition and
	// its audit event from half-applying.
	Tx(ctx context.Context, fn func(Store) error) error

	Ping(ctx context.Context) error
	Close()
}
