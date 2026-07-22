package store

import (
	"context"
	"errors"

	"console/pkg/models"
)

// seedCategories is the bootstrap category list for a fresh installation: only
// the system auto-discovery bucket. Real categories are created by the admin
// via the API; publications appear through registration or auto-discovery
// followed by adoption - nothing is pre-published.
var seedCategories = []models.Category{
	{ID: "uncategorized", Label: "Без категории", Sort: 99, Icon: "box"},
}

// SeedCategories populates the bootstrap categories if they do not exist yet.
// Idempotent: called on every start for both backends (Postgres and memory);
// existing records are left untouched, so admin edits survive a restart.
func SeedCategories(ctx context.Context, s Store) error {
	for _, c := range seedCategories {
		cat := c
		if err := s.CreateCategory(ctx, &cat); err != nil && !errors.Is(err, models.ErrConflict) {
			return err
		}
	}
	return nil
}
