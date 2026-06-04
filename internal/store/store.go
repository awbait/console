// Package store defines the persistence port and its implementations
// (Postgres for production, in-memory for tests/local).
package store

import (
	"context"

	"idp/pkg/models"
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

	Ping(ctx context.Context) error
	Close()
}
