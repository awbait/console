package changelog

import "testing"

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
- Crash on empty password
`

func TestParse(t *testing.T) {
	entries := Parse([]byte(sample))
	if len(entries) != 2 {
		t.Fatalf("want 2 entries, got %d", len(entries))
	}
	if entries[0].Version != "15.4.2" || entries[0].Date != "2026-05-20" {
		t.Fatalf("bad first entry: %+v", entries[0])
	}
	if got := entries[0].Sections["Added"]; len(got) != 1 || got[0] != "New ingress annotations support" {
		t.Fatalf("bad Added section: %+v", got)
	}
	if len(entries[0].Sections["Security"]) != 1 {
		t.Fatalf("missing Security section")
	}
	// second entry uses an em-dash separator (## [15.4.1] — 2026-05-15)
	if entries[1].Version != "15.4.1" || entries[1].Date != "2026-05-15" {
		t.Fatalf("bad second (em-dash) entry: %+v", entries[1])
	}
}

func TestParseVersion(t *testing.T) {
	e := ParseVersion([]byte(sample), "15.4.1")
	if e == nil || len(e.Sections["Fixed"]) != 1 {
		t.Fatalf("ParseVersion failed: %+v", e)
	}
	if ParseVersion([]byte(sample), "9.9.9") != nil {
		t.Fatalf("expected nil for missing version")
	}
}
