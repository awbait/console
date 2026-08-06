package changelog

import (
	"testing"

	"console/pkg/models"
)

const sample = `# Changelog

## [15.4.2] - 2026-05-20
### Added
- New ingress annotations support
### Fixed
- Memory leak in sidecar
### Security
- Bumped base image (CVE-2024-XXXX)

## [15.4.1] — 2026-05-15
### Fixed
- Crash on empty password,
  including the one typed by hand
`

// items returns the items of the named section, or nil.
func items(e models.ChangelogEntry, title string) []string {
	for _, s := range e.Sections {
		if s.Title == title {
			return s.Items
		}
	}
	return nil
}

func TestParse(t *testing.T) {
	entries := Parse([]byte(sample))
	if len(entries) != 2 {
		t.Fatalf("want 2 entries, got %d", len(entries))
	}
	if entries[0].Version != "15.4.2" || entries[0].Date != "2026-05-20" {
		t.Fatalf("bad first entry: %+v", entries[0])
	}
	if got := items(entries[0], "Added"); len(got) != 1 || got[0] != "New ingress annotations support" {
		t.Fatalf("bad Added section: %+v", got)
	}
	if len(items(entries[0], "Security")) != 1 {
		t.Fatalf("missing Security section")
	}
	// sections keep the order of the file, not the alphabet
	want := []string{"Added", "Fixed", "Security"}
	for i, s := range entries[0].Sections {
		if s.Title != want[i] {
			t.Fatalf("section %d is %q, want %q", i, s.Title, want[i])
		}
	}
	// second entry uses an em-dash separator (## [15.4.1] — 2026-05-15)
	if entries[1].Version != "15.4.1" || entries[1].Date != "2026-05-15" {
		t.Fatalf("bad second (em-dash) entry: %+v", entries[1])
	}
	// a wrapped bullet is one item, not a truncated one
	if got := items(entries[1], "Fixed"); len(got) != 1 || got[0] != "Crash on empty password, including the one typed by hand" {
		t.Fatalf("wrapped item not glued: %+v", got)
	}
}

func TestParseVersion(t *testing.T) {
	e := ParseVersion([]byte(sample), "15.4.1")
	if e == nil || len(items(*e, "Fixed")) != 1 {
		t.Fatalf("ParseVersion failed: %+v", e)
	}
	if ParseVersion([]byte(sample), "9.9.9") != nil {
		t.Fatalf("expected nil for missing version")
	}
}
