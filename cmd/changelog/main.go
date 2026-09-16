// Command changelog collects the entries waiting in changelog.d/ into a release
// section of CHANGELOG.md and CHANGELOG.ru.md.
//
// Without -version it prints what that section would look like and touches
// nothing, which is how you read what is pending: the files themselves no longer
// carry an "Unreleased" section, because that is the place every branch used to
// collide in.
//
// Run it from the repository root, or through `make changelog`.
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"console/internal/changelog"
)

var semver = regexp.MustCompile(`^\d+\.\d+\.\d+$`)

func main() {
	dir := flag.String("dir", "changelog.d", "directory holding the pending entries")
	version := flag.String("version", "", "release the entries as this version (X.Y.Z); empty only previews")
	date := flag.String("date", "", "release date (YYYY-MM-DD), defaults to today")
	en := flag.String("en", "CHANGELOG.md", "the English changelog")
	ru := flag.String("ru", "CHANGELOG.ru.md", "the Russian changelog")
	flag.Parse()

	if err := run(*dir, *version, *date, *en, *ru); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(dir, version, date, en, ru string) error {
	frs, err := changelog.ReadFragments(dir)
	if err != nil {
		return err
	}
	if len(frs) == 0 {
		return fmt.Errorf("nothing waiting in %s", dir)
	}

	if version == "" {
		fmt.Print(changelog.RenderSection(frs, "en", "Unreleased", ""))
		fmt.Println()
		fmt.Print(changelog.RenderSection(frs, "ru", "Unreleased", ""))
		fmt.Fprintf(os.Stderr, "\n%d entr%s waiting in %s. Pass -version X.Y.Z to release them.\n",
			len(frs), plural(len(frs)), dir)
		return nil
	}
	if !semver.MatchString(version) {
		return fmt.Errorf("version %q is not X.Y.Z", version)
	}
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}

	for _, f := range []struct{ path, lang string }{{en, "en"}, {ru, "ru"}} {
		b, err := os.ReadFile(f.path)
		if err != nil {
			return err
		}
		out := changelog.Insert(b, changelog.RenderSection(frs, f.lang, version, date))
		if err := os.WriteFile(f.path, out, 0o644); err != nil {
			return err
		}
		fmt.Println("wrote", f.path)
	}

	// The entries have a home now, and leaving them here would put them in the
	// next release as well.
	for _, fr := range frs {
		if err := os.Remove(filepath.Join(dir, fr.Name)); err != nil {
			return err
		}
	}
	fmt.Printf("released %d entr%s as %s\n", len(frs), plural(len(frs)), version)
	return nil
}

func plural(n int) string {
	if n == 1 {
		return "y"
	}
	return "ies"
}
