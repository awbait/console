package changelog

import (
	"console"
	"console/pkg/models"
)

// Portal returns the portal's own release notes, newest first, parsed from the
// changelog embedded into the binary. It goes through the same parser as a
// chart's changelog, so the About page and a product's "Changes" tab read the
// same shape.
func Portal() []models.ChangelogEntry {
	return Parse(console.ChangelogRU)
}
