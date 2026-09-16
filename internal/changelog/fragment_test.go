package changelog

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const goodFragment = `### Fixed

#### en
Fixed the order form refusing a service
assembled from several charts.

#### ru
Исправили отказ формы заказа на сервисе,
собранном из нескольких чартов.
`

func TestParseFragment(t *testing.T) {
	f, err := ParseFragment("x.md", []byte(goodFragment))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if f.Category != "Fixed" {
		t.Errorf("category = %q", f.Category)
	}
	// The author's line breaks are their own convenience: the entry is one
	// paragraph, and how it is shaped in the file must not reach the changelog.
	if strings.Contains(f.EN, "\n") || !strings.HasSuffix(f.EN, "several charts.") {
		t.Errorf("en = %q", f.EN)
	}
	if !strings.HasSuffix(f.RU, "нескольких чартов.") {
		t.Errorf("ru = %q", f.RU)
	}
}

// Half an entry is the mistake this format exists to make impossible: the two
// files have to hold the same entries in the same order, and a fragment carrying
// one language would break that quietly, in the file nobody reads.
func TestParseFragmentRefusesHalfAnEntry(t *testing.T) {
	for name, text := range map[string]string{
		"no ru":        "### Fixed\n\n#### en\nSomething.\n",
		"no en":        "### Fixed\n\n#### ru\nЧто-то.\n",
		"no category":  "#### en\nSomething.\n\n#### ru\nЧто-то.\n",
		"bad category": "### Улучшено\n\n#### en\nSomething.\n\n#### ru\nЧто-то.\n",
	} {
		if _, err := ParseFragment("x.md", []byte(text)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestReadFragmentsIsOrderedAndSkipsReadme(t *testing.T) {
	dir := t.TempDir()
	write := func(name, category, en string) {
		t.Helper()
		body := "### " + category + "\n\n#### en\n" + en + "\n\n#### ru\n" + en + " по-русски.\n"
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("b.md", "Fixed", "Second.")
	write("a.md", "Fixed", "First.")
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("how to write one"), 0o644); err != nil {
		t.Fatal(err)
	}

	frs, err := ReadFragments(dir)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(frs) != 2 {
		t.Fatalf("got %d entries, want 2 (the README is instructions, not an entry)", len(frs))
	}
	if frs[0].Name != "a.md" || frs[1].Name != "b.md" {
		t.Errorf("order = %s, %s", frs[0].Name, frs[1].Name)
	}
}

// Nothing waiting is not a failure: it is a repository between changes.
func TestReadFragmentsWithoutTheDirectory(t *testing.T) {
	frs, err := ReadFragments(filepath.Join(t.TempDir(), "nope"))
	if err != nil || len(frs) != 0 {
		t.Fatalf("frs=%v err=%v", frs, err)
	}
}

func TestRenderSection(t *testing.T) {
	frs := []Fragment{
		{Name: "1.md", Category: "Fixed", EN: "Fixed a thing.", RU: "Исправили штуку."},
		{Name: "2.md", Category: "Added", EN: "Added a thing.", RU: "Добавили штуку."},
		{Name: "3.md", Category: "Fixed", EN: "Fixed another thing.", RU: "Исправили другую штуку."},
	}

	en := RenderSection(frs, "en", "1.2.0", "2026-09-16")
	want := "## [1.2.0] - 2026-09-16\n\n### Added\n- Added a thing.\n\n### Fixed\n- Fixed a thing.\n- Fixed another thing.\n"
	if en != want {
		t.Errorf("en section:\n%q\nwant:\n%q", en, want)
	}

	// The categories are named in the reader's language, like everything else in
	// that file, and the entries keep the order they had.
	ru := RenderSection(frs, "ru", "1.2.0", "2026-09-16")
	if !strings.Contains(ru, "### Исправлено\n- Исправили штуку.\n- Исправили другую штуку.\n") {
		t.Errorf("ru section:\n%s", ru)
	}
	if strings.Contains(ru, "### Fixed") {
		t.Error("an English heading in the Russian file")
	}
}

func TestRenderSectionWraps(t *testing.T) {
	long := strings.TrimSpace(strings.Repeat("word ", 40))
	out := RenderSection([]Fragment{{Category: "Fixed", EN: long, RU: long}}, "en", "1.0.0", "2026-09-16")
	for _, line := range strings.Split(out, "\n") {
		if len(line) > wrapWidth {
			t.Fatalf("line of %d characters: %q", len(line), line)
		}
	}
	// Wrapped, not cut: every word is still there.
	if got := strings.Count(out, "word"); got != 40 {
		t.Errorf("kept %d words of 40", got)
	}
	if !strings.Contains(out, "\n  word") {
		t.Error("continuation lines are not indented under the first")
	}
}

func TestInsertPutsTheSectionAboveTheNewestOne(t *testing.T) {
	file := []byte("# Changelog\n\nWhat this file is.\n\n## [0.1.0] - 2026-01-01\n\n### Added\n- The first thing.\n")
	out := string(Insert(file, "## [0.2.0] - 2026-09-16\n\n### Fixed\n- A thing.\n"))

	if !strings.HasPrefix(out, "# Changelog\n\nWhat this file is.\n\n## [0.2.0]") {
		t.Fatalf("the new section did not land under the title:\n%s", out)
	}
	if strings.Index(out, "## [0.2.0]") > strings.Index(out, "## [0.1.0]") {
		t.Error("the new section is below the older one")
	}
	if !strings.Contains(out, "- A thing.\n\n## [0.1.0]") {
		t.Errorf("sections are not separated by a blank line:\n%s", out)
	}
	if !strings.HasSuffix(out, "- The first thing.\n") {
		t.Error("the tail of the file was changed")
	}
}

// Parse is what the portal reads the assembled file with, so the two have to
// agree: whatever this package writes, it must also read back.
func TestAssembledSectionParsesBack(t *testing.T) {
	frs := []Fragment{{Category: "Fixed", EN: "Fixed a thing.", RU: "Исправили штуку."}}
	file := Insert([]byte("# Changelog\n\nWhat this file is.\n"), RenderSection(frs, "en", "1.2.0", "2026-09-16"))

	entries := Parse(file)
	if len(entries) != 1 {
		t.Fatalf("parsed %d entries", len(entries))
	}
	if entries[0].Version != "1.2.0" || entries[0].Date != "2026-09-16" {
		t.Errorf("version=%q date=%q", entries[0].Version, entries[0].Date)
	}
	if len(entries[0].Sections) != 1 || entries[0].Sections[0].Title != "Fixed" ||
		len(entries[0].Sections[0].Items) != 1 {
		t.Errorf("sections = %+v", entries[0].Sections)
	}
}
