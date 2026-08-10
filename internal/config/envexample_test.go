package config

import (
	"fmt"
	"os"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

// The description of a configuration variable is written in exactly two places,
// one per audience: the `doc` tag in config.go, which the root .env.example is
// generated from, and the Russian sentence in the admin page's copy. The tests
// here hold both ends, so a new variable cannot reach the repository documented
// nowhere, and a deleted one cannot leave its text behind.

const configTextPath = "../../web/src/pages/configText.ts"

// TestEnvExampleGenerated checks that the committed .env.example is what the
// generator produces. It is the whole point of generating it: the file stays
// readable in the repository, and it cannot drift from the tags it came from.
func TestEnvExampleGenerated(t *testing.T) {
	data, err := os.ReadFile("../../.env.example")
	if err != nil {
		t.Fatalf("read .env.example: %v", err)
	}
	// Checked out with CRLF on a machine with core.autocrlf, generated with LF.
	// The difference is git's, not the content's.
	got := strings.ReplaceAll(string(data), "\r\n", "\n")
	want := RenderEnvExample()
	if got == want {
		return
	}
	t.Errorf(".env.example is out of date: run `make env-example`\n%s", firstDifference(got, want))
}

// TestEveryVariableDocumented checks that every variable says what it is for,
// on both sides: the English sentence the example is built from, and the
// Russian one the configuration page shows.
func TestEveryVariableDocumented(t *testing.T) {
	inPage := configTextKeys(t)
	inCode := map[string]bool{}
	rt := reflect.TypeFor[Config]()
	for i := range rt.NumField() {
		ft := rt.Field(i)
		name := ft.Tag.Get("env")
		if name == "" {
			continue
		}
		inCode[name] = true
		if strings.TrimSpace(ft.Tag.Get("doc")) == "" {
			t.Errorf("%s has no doc tag in config.go (the .env.example entry is generated from it)", name)
		}
		if !inPage[name] {
			t.Errorf("%s has no line in configText.ts (the configuration page would show it unexplained)", name)
		}
	}
	for name := range inPage {
		if !inCode[name] {
			t.Errorf("%s is described in configText.ts but no longer read by Config (remove it)", name)
		}
	}
}

// configTextKeys reads the variable names the admin page has copy for. Parsing
// the TypeScript with a regex is enough: the keys are env var names, which are
// upper case, and nothing else in that file is.
func configTextKeys(t *testing.T) map[string]bool {
	t.Helper()
	data, err := os.ReadFile(configTextPath)
	if err != nil {
		t.Fatalf("read configText.ts: %v", err)
	}
	out := map[string]bool{}
	for _, m := range regexp.MustCompile(`(?m)^ {2}([A-Z][A-Z0-9_]*):`).FindAllStringSubmatch(string(data), -1) {
		out[m[1]] = true
	}
	if len(out) == 0 {
		t.Fatal("no variable names found in configText.ts - has the file changed shape?")
	}
	return out
}

// firstDifference points at the line the two texts part ways on, so the failure
// names the change instead of printing two hundred identical lines.
func firstDifference(got, want string) string {
	g, w := strings.Split(got, "\n"), strings.Split(want, "\n")
	for i := range max(len(g), len(w)) {
		gl, wl := line(g, i), line(w, i)
		if gl != wl {
			return fmt.Sprintf("first difference at line %d:\n  file:      %s\n  generated: %s", i+1, gl, wl)
		}
	}
	return ""
}

func line(lines []string, i int) string {
	if i < len(lines) {
		return lines[i]
	}
	return "(end of file)"
}
