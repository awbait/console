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
