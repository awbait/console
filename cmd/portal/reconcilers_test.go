package main

import (
	"os"
	"regexp"
	"testing"
)

// A background loop is named twice: here, as the label its metrics and its log
// lines carry, and on the platform status page, as the sentence a person reads.
// The first name is an identifier and reaches the page whenever the second one
// is missing - which is how "chart-versions" and "notification-sweep" came to
// be shown to admins as themselves, next to loops that had proper names.
//
// So the two ends are held together here, the way the configuration variables
// are held by TestEveryVariableDocumented.

const statusPagePath = "../../web/src/pages/StatusPage.tsx"

func TestEveryReconcilerHasAName(t *testing.T) {
	onPage := reconcilerLabels(t)
	registered := registeredReconcilers(t)
	for name := range registered {
		if !onPage[name] {
			t.Errorf("the %q loop has no line in StatusPage.tsx, so the status page would show it by its identifier", name)
		}
	}
	for name := range onPage {
		if !registered[name] {
			t.Errorf("StatusPage.tsx names the %q loop, which nothing registers any more (remove it)", name)
		}
	}
}

// registeredReconcilers reads the names this binary wires into the poller.
func registeredReconcilers(t *testing.T) map[string]bool {
	t.Helper()
	data, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatalf("read main.go: %v", err)
	}
	out := map[string]bool{}
	for _, m := range regexp.MustCompile(`status\.Named\("([a-z-]+)"`).FindAllStringSubmatch(string(data), -1) {
		out[m[1]] = true
	}
	if len(out) == 0 {
		t.Fatal("no reconcilers found in main.go - has the wiring changed shape?")
	}
	return out
}

// reconcilerLabels reads the loops the status page has copy for. A regex over
// the TypeScript is enough: the keys of that table are the only quoted or bare
// identifiers indented by two spaces in it, and the test says so when the file
// stops looking like that.
func reconcilerLabels(t *testing.T) map[string]bool {
	t.Helper()
	data, err := os.ReadFile(statusPagePath)
	if err != nil {
		t.Fatalf("read StatusPage.tsx: %v", err)
	}
	block := regexp.MustCompile(`(?s)const RECONCILERS[^{]*\{(.*?)\n\};`).FindStringSubmatch(string(data))
	if block == nil {
		t.Fatal("no RECONCILERS table found in StatusPage.tsx - has the file changed shape?")
	}
	out := map[string]bool{}
	for _, m := range regexp.MustCompile(`(?m)^ {2}"?([a-z-]+)"?: \{`).FindAllStringSubmatch(block[1], -1) {
		out[m[1]] = true
	}
	if len(out) == 0 {
		t.Fatal("no loop names found in the RECONCILERS table")
	}
	return out
}
