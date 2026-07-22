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

	for _, sp := range seedPublications() {
		if err := seedPublication(ctx, s, sp); err != nil {
			return err
		}
	}
	return nil
}

// seedPub is one bootstrap publication together with its single approved,
// orderable version row (view documents live on versions, not the publication).
type seedPub struct {
	pub     *models.ChartPublication
	version *models.PublicationVersion
}

// seedPublication creates one approved publication (with its version row)
// unless the publication already exists.
func seedPublication(ctx context.Context, s Store, sp seedPub) error {
	_, err := s.GetPublicationByChart(ctx, sp.pub.ChartProject, sp.pub.ChartName)
	if err == nil {
		return nil // already exists, do not overwrite admin edits
	}
	if !errors.Is(err, models.ErrNotFound) {
		return err
	}
	if err := s.CreatePublication(ctx, sp.pub); err != nil {
		if errors.Is(err, models.ErrConflict) {
			return nil // race with another seeder - ok
		}
		return err
	}
	sp.version.PublicationID = sp.pub.ID
	return s.UpsertVersion(ctx, sp.version)
}

// seedPublications returns the bootstrap publications. The version row's
// Approved* fields are a snapshot shown in catalog/profile (not the live Harbor
// data); a newer version in Harbor surfaces only in "Manage" as an available update.
func seedPublications() []seedPub {
	return []seedPub{
		{
			pub: &models.ChartPublication{
				ID:                 uuid.Must(uuid.NewV7()).String(),
				ChartProject:       "platform",
				ChartName:          "ingress-gateway",
				CategoryID:         "network",
				OwnerTeam:          "core",
				CreatedBy:          "seed",
				CreatedByName:      "Seed",
				Status:             models.PubApproved,
				RecommendedVersion: "3.2.0",
			},
			version: &models.PublicationVersion{
				ID:                  uuid.Must(uuid.NewV7()).String(),
				ChartVersion:        "3.2.0",
				ApprovedViewJSON:    seedIngressView,
				Status:              models.PubApproved,
				Orderable:           true,
				ApprovedDescription: "Helm chart for Istio-based ingress gateway (Gateway API, routes, NetworkPolicy, AuthorizationPolicy, OIDC)",
			},
		},
		{
			pub: &models.ChartPublication{
				ID:                 uuid.Must(uuid.NewV7()).String(),
				ChartProject:       "platform",
				ChartName:          "managed-namespace",
				CategoryID:         "network",
				OwnerTeam:          "core",
				CreatedBy:          "seed",
				CreatedByName:      "Seed",
				Status:             models.PubApproved,
				RecommendedVersion: "1.1.0",
			},
			version: &models.PublicationVersion{
				ID:                  uuid.Must(uuid.NewV7()).String(),
				ChartVersion:        "1.1.0",
				ApprovedViewJSON:    seedNamespaceView,
				Status:              models.PubApproved,
				Orderable:           true,
				ApprovedDescription: "A Helm chart for providing namespace, resource quotas and subnet",
			},
		},
	}
}
