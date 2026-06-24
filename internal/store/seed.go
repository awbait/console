package store

import (
	"context"
	_ "embed"
	"errors"

	"github.com/google/uuid"
	"console/pkg/models"
)

// Canonical ingress-gateway view document (formerly
// web/public/schemas/ingress-gateway.ui.json), seeded as an approved publication.
//
//go:embed seed/ingress-gateway.view.json
var seedIngressView []byte

// managed-namespace view document, seeded as an approved publication. Its
// "defaults" block stamps namespace.creator=console at order time.
//
//go:embed seed/namespace.view.json
var seedNamespaceView []byte

// seedCategories is the initial catalog category list; afterwards managed
// by the admin via API.
var seedCategories = []models.Category{
	{ID: "databases", Label: "Базы данных", Sort: 10, Icon: "database"},
	{ID: "network", Label: "Сеть", Sort: 20, Icon: "network"},
	// Default category for auto-discovered charts (CATALOG_AUTODISCOVER);
	// the admin moves them to the right one during moderation.
	{ID: "uncategorized", Label: "Без категории", Sort: 99, Icon: "box"},
}

// SeedPublications populates the base categories and the approved bootstrap
// publications (ingress-gateway, managed-namespace) if they do not exist yet.
// Idempotent: called on every start for both backends (Postgres and memory);
// existing records are left untouched, so admin edits survive a restart.
func SeedPublications(ctx context.Context, s Store) error {
	for _, c := range seedCategories {
		cat := c
		if err := s.CreateCategory(ctx, &cat); err != nil && !errors.Is(err, models.ErrConflict) {
			return err
		}
	}

	for _, pub := range seedPublications() {
		if err := seedPublication(ctx, s, pub); err != nil {
			return err
		}
	}
	return nil
}

// seedPublication creates one approved publication unless it already exists.
func seedPublication(ctx context.Context, s Store, pub *models.ChartPublication) error {
	_, err := s.GetPublicationByChart(ctx, pub.ChartProject, pub.ChartName)
	if err == nil {
		return nil // already exists, do not overwrite admin edits
	}
	if !errors.Is(err, models.ErrNotFound) {
		return err
	}
	if err := s.CreatePublication(ctx, pub); err != nil && !errors.Is(err, models.ErrConflict) {
		return err
	}
	return nil
}

// seedPublications returns the bootstrap publications. The ApprovedView* fields
// are a snapshot shown in catalog/profile (not the live Harbor data); a newer
// version in Harbor surfaces only in "Manage" as an available update.
func seedPublications() []*models.ChartPublication {
	return []*models.ChartPublication{
		{
			ID:                  uuid.Must(uuid.NewV7()).String(),
			ChartProject:        "platform",
			ChartName:           "ingress-gateway",
			CategoryID:          "network",
			OwnerTeam:           "core",
			CreatedBy:           "seed",
			CreatedByName:       "Seed",
			Status:              models.PubApproved,
			ViewJSON:            seedIngressView,
			ApprovedViewJSON:    seedIngressView,
			ApprovedViewVersion: "3.2.0",
			ApprovedDescription: "Helm chart for Istio-based ingress gateway (Gateway API, routes, NetworkPolicy, AuthorizationPolicy, OIDC)",
			ApprovedIconURL:     "",
		},
		{
			ID:                  uuid.Must(uuid.NewV7()).String(),
			ChartProject:        "platform",
			ChartName:           "managed-namespace",
			CategoryID:          "network",
			OwnerTeam:           "core",
			CreatedBy:           "seed",
			CreatedByName:       "Seed",
			Status:              models.PubApproved,
			ViewJSON:            seedNamespaceView,
			ApprovedViewJSON:    seedNamespaceView,
			ApprovedViewVersion: "1.1.0",
			ApprovedDescription: "A Helm chart for providing namespace, resource quotas and subnet",
			ApprovedIconURL:     "",
		},
	}
}
