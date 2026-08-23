package models

import "time"

// PlatformUser is one person the portal has seen. The directory is built from
// sign-ins, not read from Keycloak: the portal only ever meets the person who
// is holding a token right now, so the row is created on the first visit and
// refreshed on the ones that follow.
type PlatformUser struct {
	Subject   string    `json:"subject"`
	Email     string    `json:"email"`
	Username  string    `json:"username"`
	Name      string    `json:"name"`
	Teams     []string  `json:"teams"`
	Role      Role      `json:"role"`
	FirstSeen time.Time `json:"first_seen"`
	LastSeen  time.Time `json:"last_seen"`
	// Visits counts windows of activity, not requests: the row is written at
	// most once every few minutes per person (see internal/activity).
	Visits int64 `json:"visits"`
	// Online is filled in when the directory is read, from presence in the
	// cache. It is not stored: nothing on disk can say who is here now.
	Online bool `json:"online,omitempty"`
	// SeenAgo is how long ago presence last saw this person, in seconds. Only
	// meaningful together with Online.
	SeenAgo int64 `json:"seen_ago,omitempty"`
}

// DisplayName is what to print for a person: their name, falling back to
// whatever else the token carried, and finally to the subject so a row is never
// nameless.
func (u *PlatformUser) DisplayName() string {
	switch {
	case u.Name != "":
		return u.Name
	case u.Username != "":
		return u.Username
	case u.Email != "":
		return u.Email
	default:
		return u.Subject
	}
}

// Actors that are not people: the reconcile loop advancing an order on its own,
// and catalog auto-discovery registering a chart nobody has claimed. Their
// events belong in the order's timeline, where they explain what happened, and
// not in a page about who is using the portal.
const (
	ActorSystem        = "system"
	ActorAutoDiscovery = "auto-discovery"
)

// IsSystemActor reports whether an event was written by the platform itself
// rather than by a person. An empty subject counts as one: everything a person
// does records who they were.
func IsSystemActor(subject string) bool {
	switch subject {
	case "", ActorSystem, ActorAutoDiscovery:
		return true
	}
	return false
}

// SystemActors is the same set as a list, for a query that has to exclude them.
func SystemActors() []string { return []string{ActorSystem, ActorAutoDiscovery} }

// ActivitySource says which journal an activity event came from.
type ActivitySource string

const (
	ActivityOrder       ActivitySource = "order"
	ActivityPublication ActivitySource = "publication"
)

// ActivityEvent is one thing a person did, read from the order and publication
// journals. It is an overview row, not an audit record: the audit trail stays
// in request_events / publication_events with everything those carry.
type ActivityEvent struct {
	At         time.Time      `json:"at"`
	Source     ActivitySource `json:"source"`
	Actor      string         `json:"actor"`
	ActorName  string         `json:"actor_name"`
	EventType  string         `json:"event_type"`
	FromStatus string         `json:"from_status,omitempty"`
	ToStatus   string         `json:"to_status,omitempty"`
	// SubjectID is the order or publication the event is about, and Title is how
	// to name it on screen (service name, or chart path for a publication).
	SubjectID string `json:"subject_id"`
	Title     string `json:"title"`
	Team      string `json:"team"`
}

// ActivityCount is how many things of one kind one team did in a window. It
// exists for the gauges: the page shows the events themselves.
type ActivityCount struct {
	EventType string `json:"event_type"`
	Team      string `json:"team"`
	Count     int    `json:"count"`
}

// TeamActivity is one team as the activity page shows it: how many people the
// portal has seen from it, and how many of them are around.
type TeamActivity struct {
	Team      string          `json:"team"`
	Members   int             `json:"members"`
	Online    int             `json:"online"`
	Active24h int             `json:"active_24h"`
	People    []*PlatformUser `json:"people,omitempty"`
}
