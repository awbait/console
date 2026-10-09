package store

import (
	"context"
	"errors"

	"github.com/google/uuid"
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

// SeedDefaultStand makes sure there is a stand to place orders on. On the first
// start after the upgrade that introduced stands there is none: one is created
// from the configured default cluster, marked default, and every order written
// before stands existed is attached to it. Nothing about those orders moves -
// their cluster is the one the new stand is made of, so the paths in Git and
// the applications in Argo CD are what they were.
//
// Idempotent and cheap afterwards: a store that already holds a stand is left
// alone, whatever the admin has renamed or re-pointed it to since. The
// configured cluster only ever seeds; it does not overwrite.
//
// Orphans are adopted on every start, not only the first: a row with no stand
// cannot be written by this version of the portal, so finding one means the
// previous adoption did not finish, and the right thing is to finish it.
func SeedDefaultStand(ctx context.Context, s Store, cluster string) (adopted int, err error) {
	def, err := s.DefaultStand(ctx)
	switch {
	case errors.Is(err, models.ErrNotFound):
		def = &models.Stand{ID: uuid.NewString(), Name: models.DefaultStandName, DefaultCluster: cluster, Default: true}
		if err := s.CreateStand(ctx, def); err != nil {
			if !errors.Is(err, models.ErrConflict) {
				return 0, err
			}
			// Another replica got here first: read what it wrote.
			if def, err = s.DefaultStand(ctx); err != nil {
				return 0, err
			}
		}
	case err != nil:
		return 0, err
	}
	return s.AdoptOrphanRequests(ctx, def.ID)
}
