package changelog

// One changelog entry, written where the change was made and kept in a file of
// its own until a release collects it.
//
// The entry used to be appended straight into CHANGELOG.md and CHANGELOG.ru.md,
// always at the same place: under "## [Unreleased]", at the end of its category.
// Two branches open at once therefore wrote the same two lines of the same two
// files, and git had no way to tell one from the other. Every branch after the
// first was merged by hand, in both languages, again after each merge. A file
// per entry has no such place to collide in.
//
// Both languages live in the one file, and neither is optional. They are two
// halves of the same entry, and the rule they have to keep - the same entries in
// the same order in both files - is then kept by construction rather than by a
// test noticing afterwards that somebody wrote only one.

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"unicode/utf8"
)

// Categories, in the order a release section lists them. Only these: a category
// nobody recognises would be dropped from the assembled section without a word.
var categories = []string{"Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"}

// Russian names of the same categories. The two files are one document in two
// languages, so the headings are translated with everything else.
var categoryRU = map[string]string{
	"Added":      "Добавлено",
	"Changed":    "Изменено",
	"Deprecated": "Устарело",
	"Removed":    "Удалено",
	"Fixed":      "Исправлено",
	"Security":   "Безопасность",
}

// Fragment is one entry: which category it belongs to and what it says in each
// language. Name is the file it came from - it orders entries within a category
// and names the file in an error.
type Fragment struct {
	Name     string
	Category string
	EN       string
	RU       string
}

// The fragment format, which is the changelog's own format one level down:
//
//	### Fixed
//
//	#### en
//	Fixed the order form refusing a service assembled from several charts.
//
//	#### ru
//	Исправили отказ формы заказа на сервисе, собранном из нескольких чартов.
//
// Line breaks inside an entry are the author's convenience and carry no
// meaning: the text is one paragraph, and the assembler wraps it itself, so a
// fragment cannot produce a differently shaped line from everything around it.
func ParseFragment(name string, content []byte) (Fragment, error) {
	f := Fragment{Name: name}
	var lang string
	var en, ru []string

	for line := range strings.SplitSeq(string(content), "\n") {
		trimmed := strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(trimmed, "#### "):
			lang = strings.ToLower(strings.TrimSpace(trimmed[5:]))
		case strings.HasPrefix(trimmed, "### "):
			f.Category = strings.TrimSpace(trimmed[4:])
		case trimmed == "":
		case lang == "en":
			en = append(en, trimmed)
		case lang == "ru":
			ru = append(ru, trimmed)
		default:
			return f, fmt.Errorf("%s: text before any of #### en / #### ru: %q", name, trimmed)
		}
	}

	f.EN, f.RU = strings.Join(en, " "), strings.Join(ru, " ")
	if f.Category == "" {
		return f, fmt.Errorf("%s: no category. Open the file with a line like \"### Fixed\"", name)
	}
	if !known(f.Category) {
		return f, fmt.Errorf("%s: unknown category %q. Use one of: %s",
			name, f.Category, strings.Join(categories, ", "))
	}
	if f.EN == "" || f.RU == "" {
		return f, fmt.Errorf("%s: an entry is written in both languages, and this one has only %s",
			name, present(f))
	}
	return f, nil
}

func known(category string) bool {
	return slices.Contains(categories, category)
}

func present(f Fragment) string {
	switch {
	case f.EN != "":
		return "#### en"
	case f.RU != "":
		return "#### ru"
	}
	return "neither"
}

// ReadFragments reads every entry waiting in dir, ordered by file name so an
// assembled section comes out the same whoever runs it. A missing directory is
// not an error: it means nothing is waiting.
func ReadFragments(dir string) ([]Fragment, error) {
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") || strings.HasPrefix(e.Name(), "README") {
			continue
		}
		names = append(names, e.Name())
	}
	sort.Strings(names)

	out := make([]Fragment, 0, len(names))
	for _, name := range names {
		b, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			return nil, err
		}
		f, err := ParseFragment(name, b)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, nil
}

// wrapWidth is where a line of the changelog breaks, matching what the files
// already hold.
const wrapWidth = 80

// item renders one entry as the list item the changelog is made of: "- " and
// the text, wrapped, continuation lines indented under the first.
//
// Width is counted in characters, not bytes. Half of what goes through here is
// Russian, where a byte count wraps every line at roughly half the width and the
// two files come out visibly different shapes.
func item(text string) string {
	var b strings.Builder
	line := "-"
	width := utf8.RuneCountInString(line)
	for word := range strings.FieldsSeq(text) {
		w := utf8.RuneCountInString(word)
		if width+1+w > wrapWidth && line != "-" {
			b.WriteString(line + "\n")
			line, width = " ", 1
		}
		line += " " + word
		width += 1 + w
	}
	b.WriteString(line + "\n")
	return b.String()
}

// RenderSection builds the release section for one language: the heading, then
// every category that has entries, in the canonical order.
//
// date may be empty while previewing, where there is no release to date yet.
func RenderSection(frs []Fragment, lang, version, date string) string {
	var b strings.Builder
	if date != "" {
		fmt.Fprintf(&b, "## [%s] - %s\n", version, date)
	} else {
		fmt.Fprintf(&b, "## [%s]\n", version)
	}
	for _, category := range categories {
		var items []string
		for _, f := range frs {
			if f.Category != category {
				continue
			}
			text := f.EN
			if lang == "ru" {
				text = f.RU
			}
			items = append(items, item(text))
		}
		if len(items) == 0 {
			continue
		}
		heading := category
		if lang == "ru" {
			heading = categoryRU[category]
		}
		fmt.Fprintf(&b, "\n### %s\n", heading)
		for _, it := range items {
			b.WriteString(it)
		}
	}
	return b.String()
}

// Insert puts a rendered section into a changelog, above the newest version
// already there. The file opens with a title and a line saying what it is; the
// section goes after those and before everything else, because a changelog is
// read newest first.
func Insert(file []byte, section string) []byte {
	text := strings.ReplaceAll(string(file), "\r\n", "\n")
	at := strings.Index(text, "\n## ")
	if at < 0 {
		return []byte(strings.TrimRight(text, "\n") + "\n\n" + section)
	}
	head := strings.TrimRight(text[:at], "\n")
	rest := strings.TrimLeft(text[at:], "\n")
	return []byte(head + "\n\n" + section + "\n" + rest)
}
