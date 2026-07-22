package models

import (
	"encoding/json"
	"time"
)

// PublicationStatus is the approval lifecycle shared by the publication-level
// metadata FSM (category/owner changes) and the per-version view FSM.
// "Published" (the order form is available) is a per-version property (see
// PublicationVersion.Published), not a status of the publication itself.
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
// owner (owner_team manages, created_by, author). View documents live on the
// publication's versions (PublicationVersion), one per published chart version.
type ChartPublication struct {
	ID            string            `json:"id"`
	ChartProject  string            `json:"chart_project"`
	ChartName     string            `json:"chart_name"`
	CategoryID    string            `json:"category_id"`
	OwnerTeam     string            `json:"owner_team"`
	CreatedBy     string            `json:"created_by"`
	CreatedByName string            `json:"created_by_name"`
	Status        PublicationStatus `json:"status"`
	// EffectiveStatus is the aggregate approval status derived from the versions
	// (see DeriveStatus). Computed at read time, never persisted: Status alone is
	// misleading for multi-version publications. Empty unless the read path fills
	// it in.
	EffectiveStatus PublicationStatus `json:"effective_status,omitempty"`
	// DraftCategoryID/DraftOwnerTeam is a proposed but not yet approved metadata
	// change. Live values (CategoryID/OwnerTeam, used by the catalog and
	// permissions) change only on approve; an empty string - no pending changes.
	DraftCategoryID string `json:"draft_category_id,omitempty"`
	DraftOwnerTeam  string `json:"draft_owner_team,omitempty"`
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


// DeriveStatus computes a publication's effective (aggregate) status from its
// versions. The DB Status column tracks only the metadata/legacy-view FSM, which
// stays DRAFT while approvals happen per version, so the admin UI and catalog
// must read this instead of Status directly.
//
// Precedence: a metadata change or any version under review -> PENDING (needs
// admin action); otherwise any APPROVED version -> APPROVED; any REJECTED version
// -> REJECTED; else the publication-level Status (DRAFT for a fresh publication,
// or the legacy single-view status).
func DeriveStatus(p *ChartPublication, versions []*PublicationVersion) PublicationStatus {
	var hasApproved, hasRejected, hasPending bool
	for _, v := range versions {
		switch v.Status {
		case PubApproved:
			hasApproved = true
		case PubRejected:
			hasRejected = true
		case PubPending:
			hasPending = true
		}
	}
	switch {
	case p.Status == PubPending || hasPending:
		return PubPending
	case hasApproved:
		return PubApproved
	case hasRejected:
		return PubRejected
	default:
		return p.Status
	}
}

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
