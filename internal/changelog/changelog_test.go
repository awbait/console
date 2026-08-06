package changelog

import "testing"

// TestPortalEmbedded checks the embedded changelog parses into versions with
// items (guards against an unparseable file shape reaching the About page).
func TestPortalEmbedded(t *testing.T) {
	rels := Portal()
	if len(rels) == 0 {
		t.Fatal("no releases parsed from the embedded changelog")
	}
	var items int
	for _, r := range rels {
		if r.Version == "" {
			t.Fatalf("release without a version: %+v", r)
		}
		for _, s := range r.Sections {
			items += len(s.Items)
		}
	}
	if items == 0 {
		t.Fatal("embedded changelog parsed into no items")
	}
}
