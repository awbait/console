package models

import "time"

// NotificationAudience is who a notification is for. It is a rule, not a list:
// the portal keeps no user directory, and the members of a team change between
// the moment something happens and the moment somebody reads about it.
type NotificationAudience string

const (
	// AudienceUser addresses one person by their OIDC subject.
	AudienceUser NotificationAudience = "user"
	// AudienceTeam addresses everyone who is in a team at reading time.
	AudienceTeam NotificationAudience = "team"
	// AudienceRole addresses everyone holding a role (admins, security).
	AudienceRole NotificationAudience = "role"
	// AudienceAll addresses every signed-in person - platform announcements.
	AudienceAll NotificationAudience = "all"
)

// NotificationLevel separates news from something that wants attention. Only
// two: a scale with five steps is a scale nobody agrees on.
type NotificationLevel string

const (
	LevelInfo      NotificationLevel = "info"
	LevelAttention NotificationLevel = "attention"
)

// What a notification is about, and therefore where clicking it leads. The link
// is built from the type and the id, never stored as a string: routes change,
// and a stored URL rots silently in old rows.
const (
	SubjectOrder       = "order"
	SubjectPublication = "publication"
	SubjectVersion     = "version"
	SubjectPlatform    = "platform"
)

// The kinds of notification the portal sends. A kind is the whole meaning: the
// sentence a person reads is composed in the interface from the kind and the
// payload, so wording can be rewritten without touching what is stored.
const (
	// An order of the person who filed it.
	NotifyOrderHealthy       = "order_healthy"
	NotifyOrderDegraded      = "order_degraded"
	NotifyOrderChangeBlocked = "order_change_blocked"
	// A version of a service its owner published.
	NotifyVersionApproved = "version_approved"
	NotifyVersionRejected = "version_rejected"
	// A release in the registry the owners have not published yet.
	NotifyChartVersionAvailable = "chart_version_available"
	// Work waiting for the platform team: a version sent for approval, and a
	// chart the portal found in the registry that nobody has adopted.
	NotifyVersionSubmitted = "version_submitted"
	NotifyChartDiscovered  = "chart_discovered"
	// A published version the registry no longer has.
	NotifyChartVersionMissing = "chart_version_missing"
	// The portal itself.
	NotifyPortalUpdated = "portal_updated"
)

// Notification is one thing worth telling somebody about. One row per event,
// not per recipient: see NotificationAudience.
type Notification struct {
	ID          string               `json:"id"`
	Kind        string               `json:"kind"`
	SubjectType string               `json:"subject_type"`
	SubjectID   string               `json:"subject_id,omitempty"`
	Audience    NotificationAudience `json:"-"`
	AudienceKey string               `json:"-"`
	// Actor is the OIDC subject of the person whose action caused this, empty
	// for anything the platform did on its own. ActorName is their display name,
	// recorded here because there is nowhere to look it up later.
	Actor     string            `json:"-"`
	ActorName string            `json:"actor_name,omitempty"`
	Payload   map[string]any    `json:"payload,omitempty"`
	Level     NotificationLevel `json:"level"`
	// DedupKey makes a notification idempotent: the background loop revisits the
	// same order every 15 seconds, and only the first pass should be news. Empty
	// means "no deduplication" - a genuinely one-off event.
	DedupKey  string    `json:"-"`
	CreatedAt time.Time `json:"created_at"`
	// Read is filled per reader, not stored on the row itself.
	Read bool `json:"read"`
}
