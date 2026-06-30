package models

import (
	"encoding/json"
	"time"
)

// PublicationStatus is the lifecycle of a publication's view document draft.
// "Published" (the order form is available) is determined by the presence of
// ApprovedViewJSON, not by status: the approved version keeps working
// while a new draft is under review.
type PublicationStatus string

const (
	PubDraft    PublicationStatus = "DRAFT"
	PubPending  PublicationStatus = "PENDING"
	PubApproved PublicationStatus = "APPROVED"
	PubRejected PublicationStatus = "REJECTED"
)

// Category groups published charts in the catalog and the left menu.
type Category struct {
	ID    string `json:"id"` // slug
	Label string `json:"label"`
	Sort  int    `json:"sort"`
	// Icon is the chosen icon slug (client-side palette in icons.tsx); empty
	// falls back to a default. Cosmetic only.
	Icon string `json:"icon"`
	// System marks a built-in category that must not be deleted (e.g. the
	// auto-discovery bucket). Computed on read, never persisted.
	System bool `json:"system,omitempty"`
}

// ChartPublication is portal metadata on top of a Harbor chart: category,
// owner (owner_team manages, created_by, author) and the view document
// (formerly web/public/schemas/<chart>.ui.json).
type ChartPublication struct {
	ID            string            `json:"id"`
	ChartProject  string            `json:"chart_project"`
	ChartName     string            `json:"chart_name"`
	CategoryID    string            `json:"category_id"`
	OwnerTeam     string            `json:"owner_team"`
	CreatedBy     string            `json:"created_by"`
	CreatedByName string            `json:"created_by_name"`
	Status        PublicationStatus `json:"status"`
	// DraftCategoryID/DraftOwnerTeam is a proposed but not yet approved metadata
	// change. Live values (CategoryID/OwnerTeam, used by the catalog and
	// permissions) change only on approve; an empty string - no pending changes.
	DraftCategoryID string `json:"draft_category_id,omitempty"`
	DraftOwnerTeam  string `json:"draft_owner_team,omitempty"`
	// ViewJSON is the editable view document draft; ApprovedViewJSON is the
	// active approved version (order forms are built from it).
	ViewJSON         json.RawMessage `json:"view_json,omitempty"`
	ApprovedViewJSON json.RawMessage `json:"approved_view_json,omitempty"`
	// ApprovedViewVersion is the chart version (latest at approve time) the
	// active view is approved for. The "blessed" version: up to it the view is
	// checked, orders can be updated; newer in Harbor - the author should update the view.
	ApprovedViewVersion string `json:"approved_view_version,omitempty"`
	// ApprovedDescription is the chart description (from Chart.yaml/Harbor) at approve time.
	// The catalog shows it, not the live one from Harbor: data is refreshed only after
	// a new approval.
	ApprovedDescription string `json:"approved_description,omitempty"`
	// ApprovedIconURL is the chart icon (Chart.yaml icon) at approve time. The catalog and
	// chart profile show it, not the live one from Harbor - otherwise a new version with a new
	// icon would "leak" into the catalog before approval. Empty = no icon.
	ApprovedIconURL string `json:"approved_icon_url,omitempty"`
	// RecommendedVersion is the chart version the owner marks as recommended for
	// new orders. Empty or pointing at a non-orderable version means "fall back
	// to the highest orderable APPROVED version" (resolved at read time).
	RecommendedVersion string    `json:"recommended_version,omitempty"`
	ReviewedBy         string    `json:"reviewed_by,omitempty"`
	ReviewComment      string    `json:"review_comment,omitempty"`
	Version            int       `json:"version"` // optimistic lock
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

// Published reports whether the publication has an active approved view.
//
// Deprecated for multi-version: a service is "published" when at least one of
// its PublicationVersion rows is orderable and APPROVED with an order view (see
// PublicationVersion.Published). This single-view flag stays during the
// transition while the approved_* columns are still read.
func (p *ChartPublication) Published() bool { return len(p.ApprovedViewJSON) > 0 }

// PendingMeta reports whether there is an unapproved category/owner change.
func (p *ChartPublication) PendingMeta() bool {
	return p.DraftCategoryID != "" || p.DraftOwnerTeam != ""
}

// PublicationVersion is one published version of a service (chart). A
// ChartPublication is the service (owner, category, chart coordinates); its
// versions live 1:N here, each with its own view document and approval FSM. The
// status reuses PublicationStatus (DRAFT -> PENDING -> APPROVED | REJECTED).
type PublicationVersion struct {
	ID            string `json:"id"`
	PublicationID string `json:"publication_id"`
	// ChartVersion is the chart version in Harbor this row publishes a view for.
	// Unique within a publication.
	ChartVersion string `json:"chart_version"`
	// ViewJSON is the editable view draft for this version; ApprovedViewJSON is
	// the approved view that order forms are built from.
	ViewJSON         json.RawMessage   `json:"view_json,omitempty"`
	ApprovedViewJSON json.RawMessage   `json:"approved_view_json,omitempty"`
	Status           PublicationStatus `json:"status"`
	// Orderable is the owner-controlled allowlist flag: only orderable versions
	// can be selected when placing an order.
	Orderable bool `json:"orderable"`
	// ApprovedDescription/ApprovedIconURL are Harbor snapshots taken at approve
	// time (the catalog shows these, not live Harbor data).
	ApprovedDescription string    `json:"approved_description,omitempty"`
	ApprovedIconURL     string    `json:"approved_icon_url,omitempty"`
	ReviewedBy          string    `json:"reviewed_by,omitempty"`
	ReviewComment       string    `json:"review_comment,omitempty"`
	Version             int       `json:"version"` // optimistic lock
	CreatedAt           time.Time `json:"created_at"`
	UpdatedAt           time.Time `json:"updated_at"`
}

// Orderable + APPROVED + carrying an approved view: this version can serve order
// forms. The presence of an "order" view inside the document is checked by the
// publications service (it needs to parse the view), not here.
func (v *PublicationVersion) Published() bool {
	return v.Status == PubApproved && v.Orderable && len(v.ApprovedViewJSON) > 0
}

// PublicationEvent is a publication audit / status-change record.
type PublicationEvent struct {
	ID            int64             `json:"id"`
	PublicationID string            `json:"publication_id"`
	Actor         string            `json:"actor"`
	EventType     string            `json:"event_type"`
	FromStatus    PublicationStatus `json:"from_status,omitempty"`
	ToStatus      PublicationStatus `json:"to_status,omitempty"`
	Payload       map[string]any    `json:"payload,omitempty"`
	CreatedAt     time.Time         `json:"created_at"`
}
