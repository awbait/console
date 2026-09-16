// Package argocd defines the ArgoCD port and shared types.
package argocd

import (
	"context"
)

// SyncStatus mirrors ArgoCD's sync status.
type SyncStatus string

const (
	SyncSynced    SyncStatus = "Synced"
	SyncOutOfSync SyncStatus = "OutOfSync"
	SyncUnknown   SyncStatus = "Unknown"
)

// HealthStatus mirrors ArgoCD's health status.
type HealthStatus string

const (
	HealthHealthy     HealthStatus = "Healthy"
	HealthProgressing HealthStatus = "Progressing"
	HealthDegraded    HealthStatus = "Degraded"
	HealthMissing     HealthStatus = "Missing"
	HealthUnknown     HealthStatus = "Unknown"
)

// Application is an ArgoCD Application (trimmed to what the portal needs).
type Application struct {
	Name    string            `json:"name"`
	Project string            `json:"project"`
	Cluster string            `json:"cluster"`
	Sync    SyncStatus        `json:"sync_status"`
	Health  HealthStatus      `json:"health_status"`
	Labels  map[string]string `json:"labels,omitempty"`
	// Revision / Revisions are the git revision(s) ArgoCD last synced. Singular
	// for single-source apps, the array for multi-source (one per source). Used to
	// tell whether ArgoCD has actually applied the target commit yet (vs reporting
	// Healthy/Synced for a stale revision right after an MR merge).
	Revision  string   `json:"revision,omitempty"`
	Revisions []string `json:"revisions,omitempty"`
	// Error is what ArgoCD says is wrong with this application, when it says
	// anything. It comes from status.conditions and is the only place an
	// application that cannot even be rendered explains itself: a chart whose
	// values do not template, a dependency it cannot fetch, a spec it refuses.
	// Health stays Unknown in those cases, so without this the portal has nothing
	// to go on and the order waits for a health that will never arrive.
	Error string `json:"error,omitempty"`
}

// errorCondition reports whether an ArgoCD condition type names a failure.
//
// ArgoCD spells them ComparisonError, SyncError, InvalidSpecError, and adds to
// the list between versions. Matching the suffix rather than an allowlist is
// deliberate: an unknown condition ending in Error is far more likely to be a
// new name for a failure than something safe to swallow, and swallowing is what
// this whole thing is about.
func errorCondition(kind string) bool {
	return len(kind) > 5 && kind[len(kind)-5:] == "Error"
}

// Port is the portal's view of ArgoCD: one application at a time, which is how
// the portal works with it - an order knows the name of its own application.
type Port interface {
	// GetApplication returns one application; ErrNotFound if absent.
	GetApplication(ctx context.Context, name string) (*Application, error)
	// Sync forces a sync (admin action).
	Sync(ctx context.Context, name string) error
	// EnsureCascadingDelete makes the application take its deployed resources
	// with it when it is removed. Called before the change that removes its
	// manifest; ErrNotFound if there is no such application.
	EnsureCascadingDelete(ctx context.Context, name string) error

	Healthz(ctx context.Context) error
}
