package config

import (
	"strings"
	"testing"
)

// upstreams are the variables a deployment cannot run without: the portal talks
// to the real Harbor, GitLab and Argo CD, and a missing address or token means
// it would come up serving nothing. The guarantee used to be five hand-written
// checks in main; it now lives in the env tags, and this is what holds it there.
var upstreams = []string{"HARBOR_URL", "GITLAB_URL", "GITLAB_TOKEN", "ARGOCD_URL", "ARGOCD_TOKEN"}

func TestLoadRefusesMissingUpstreams(t *testing.T) {
	// Set to empty rather than left to the machine: the test then says the same
	// thing whether or not the developer running it has a stand configured.
	for _, name := range upstreams {
		t.Setenv(name, "")
	}
	_, err := Load()
	if err == nil {
		t.Fatal("Load accepted a configuration with no upstreams")
	}
	// Every one of them, in one message: a deployment that is missing three
	// variables should learn that once, not three restarts in a row.
	for _, name := range upstreams {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("%s is not named in the error: %v", name, err)
		}
	}
}

func TestLoadAcceptsConfiguredUpstreams(t *testing.T) {
	for _, name := range upstreams {
		t.Setenv(name, "set")
	}
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.HarborURL != "set" {
		t.Errorf("HarborURL = %q, want the value from the environment", cfg.HarborURL)
	}
}
