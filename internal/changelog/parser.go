// Package changelog parses Keep a Changelog formatted CHANGELOG.md files.
package changelog

import (
	"bufio"
	"bytes"
	"regexp"
	"strings"

	"console/pkg/models"
)

// header matches lines like: ## [15.4.2] - 2026-05-20  (date optional). The
// version/date separator may be a hyphen or an en/em dash (— is common in
// hand-written changelogs), so accept any of -, –, —.
var header = regexp.MustCompile(`^##\s+\[([^\]]+)\](?:\s*[-\x{2013}\x{2014}]\s*(.+))?\s*$`)

// Parse turns CHANGELOG.md content into ordered entries (top-to-bottom).
func Parse(content []byte) []models.ChangelogEntry {
	var entries []models.ChangelogEntry
	var cur *models.ChangelogEntry
	var section string

	sc := bufio.NewScanner(bytes.NewReader(content))
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		line := sc.Text()
		if m := header.FindStringSubmatch(line); m != nil {
			if cur != nil {
				entries = append(entries, *cur)
			}
			// Sections starts empty rather than nil: a version heading with
			// nothing under it yet (the [Unreleased] left after a release) must
			// still serialise as a list, not as null.
			cur = &models.ChangelogEntry{
				Version:  strings.TrimSpace(m[1]),
				Date:     strings.TrimSpace(m[2]),
				Sections: []models.ChangelogSection{},
			}
			section = ""
			continue
		}
		if cur == nil {
			continue
		}
		if s, ok := strings.CutPrefix(line, "### "); ok {
			section = strings.TrimSpace(s)
			continue
		}
		trimmed := strings.TrimSpace(line)
		if (strings.HasPrefix(trimmed, "- ") || strings.HasPrefix(trimmed, "* ")) && section != "" {
			addItem(cur, section, strings.TrimSpace(trimmed[2:]))
			continue
		}
		if trimmed == "" {
			continue
		}
		// Prose before the first category introduces the release.
		if section == "" {
			cur.Intro = strings.TrimSpace(cur.Intro + " " + trimmed)
			continue
		}
		// A wrapped bullet continues the previous item: the file wraps at 80
		// columns, the reader does not.
		if strings.HasPrefix(line, "  ") {
			appendToLast(cur, trimmed)
		}
	}
	if cur != nil {
		entries = append(entries, *cur)
	}
	return entries
}

// addItem files an item under its section, creating the section on first use so
// the sections keep the order the file lists them in.
func addItem(e *models.ChangelogEntry, section, item string) {
	for i := range e.Sections {
		if e.Sections[i].Title == section {
			e.Sections[i].Items = append(e.Sections[i].Items, item)
			return
		}
	}
	e.Sections = append(e.Sections, models.ChangelogSection{Title: section, Items: []string{item}})
}

// appendToLast glues a wrapped line onto the item it continues.
func appendToLast(e *models.ChangelogEntry, text string) {
	if len(e.Sections) == 0 {
		return
	}
	s := &e.Sections[len(e.Sections)-1]
	if len(s.Items) == 0 {
		return
	}
	s.Items[len(s.Items)-1] += " " + text
}

// ParseVersion returns the single entry matching version, or nil.
func ParseVersion(content []byte, version string) *models.ChangelogEntry {
	for _, e := range Parse(content) {
		if e.Version == version {
			ec := e
			return &ec
		}
	}
	return nil
}
