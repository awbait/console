package checks

import (
	"context"
	"errors"
	"testing"
	"time"

	"console/internal/argocd"
	"console/internal/config"
	"console/internal/gitlab"
	"console/internal/harbor"
	"console/pkg/models"
)

// --- fakes -------------------------------------------------------------------

// fakeGitLab answers the inspection calls from fields, so a test states the
// GitLab it is describing instead of building one.
type fakeGitLab struct {
	account     *gitlab.Account
	accountErr  error
	token       *gitlab.TokenInfo
	tokenErr    error
	group       *gitlab.Group
	groupErr    error
	access      int
	accessErr   error
	groupHooks  []gitlab.HookInfo
	systemHooks []gitlab.HookInfo
	projects    []gitlab.Project
	projHooks   map[int][]gitlab.HookInfo
	tested      int // how many test deliveries were asked for
	testErr     error
}

func (f *fakeGitLab) CurrentUser(context.Context) (*gitlab.Account, error) {
	return f.account, f.accountErr
}
func (f *fakeGitLab) TokenInfo(context.Context) (*gitlab.TokenInfo, error) {
	return f.token, f.tokenErr
}
func (f *fakeGitLab) GetGroup(context.Context, string) (*gitlab.Group, error) {
	return f.group, f.groupErr
}
func (f *fakeGitLab) GroupAccessLevel(context.Context, string, int) (int, error) {
	return f.access, f.accessErr
}
func (f *fakeGitLab) ListGroupHooks(context.Context, string) ([]gitlab.HookInfo, error) {
	return f.groupHooks, nil
}
func (f *fakeGitLab) ListSystemHooks(context.Context) ([]gitlab.HookInfo, error) {
	return f.systemHooks, nil
}
func (f *fakeGitLab) ListProjectHooks(_ context.Context, id int) ([]gitlab.HookInfo, error) {
	return f.projHooks[id], nil
}
func (f *fakeGitLab) ListGroupProjects(context.Context) ([]gitlab.Project, error) {
	return f.projects, nil
}
func (f *fakeGitLab) TestHook(context.Context, gitlab.HookScope, int, int) error {
	f.tested++
	return f.testErr
}

// scopeOf is a HookScoper with a fixed answer.
type scopeOf gitlab.HookScope

func (s scopeOf) Scope() gitlab.HookScope { return gitlab.HookScope(s) }

// fakeDeliveries reports fixed counters.
type fakeDeliveries struct {
	counts map[string]DeliveryCounts
	since  time.Time
}

func (f fakeDeliveries) Get(source string) DeliveryCounts { return f.counts[source] }
func (f fakeDeliveries) Since() time.Time                 { return f.since }

// --- GitLab ------------------------------------------------------------------

func TestGitLabToken(t *testing.T) {
	soon := time.Now().Add(10 * 24 * time.Hour).Format(time.DateOnly)
	past := time.Now().Add(-24 * time.Hour).Format(time.DateOnly)
	cases := []struct {
		name   string
		api    *fakeGitLab
		want   Verdict
		reason string
	}{
		{
			"api scope, no expiry",
			&fakeGitLab{account: &gitlab.Account{Username: "portal"}, token: &gitlab.TokenInfo{Scopes: []string{"api"}, Active: true, Name: "portal"}},
			VerdictOK, "",
		},
		{
			"read-only token passes every health probe and fails the first order",
			&fakeGitLab{account: &gitlab.Account{Username: "portal"}, token: &gitlab.TokenInfo{Scopes: []string{"read_api"}, Active: true, Name: "portal"}},
			VerdictFail, reasonMissingScope,
		},
		{
			"expiring soon",
			&fakeGitLab{account: &gitlab.Account{Username: "portal"}, token: &gitlab.TokenInfo{Scopes: []string{"api"}, ExpiresAt: soon, Active: true, Name: "portal"}},
			VerdictWarn, reasonExpiresSoon,
		},
		{
			"already expired",
			&fakeGitLab{account: &gitlab.Account{Username: "portal"}, token: &gitlab.TokenInfo{Scopes: []string{"api"}, ExpiresAt: past, Active: true, Name: "portal"}},
			VerdictFail, reasonExpired,
		},
		{
			"revoked",
			&fakeGitLab{account: &gitlab.Account{Username: "portal"}, token: &gitlab.TokenInfo{Scopes: []string{"api"}, Revoked: true, Name: "portal"}},
			VerdictFail, reasonRevoked,
		},
		{
			// A group access token: it works, GitLab just will not describe it.
			"introspection unavailable",
			&fakeGitLab{account: &gitlab.Account{Username: "portal"}, tokenErr: gitlab.ErrTokenIntrospectionUnavailable},
			VerdictUnknown, reasonNoIntrospect,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := gitlabToken(context.Background(), tc.api)
			if got.Verdict != tc.want || got.Reason != tc.reason {
				t.Fatalf("got %s/%s, want %s/%s", got.Verdict, got.Reason, tc.want, tc.reason)
			}
		})
	}
}

func TestGitLabGroupAccess(t *testing.T) {
	cases := []struct {
		name      string
		api       *fakeGitLab
		subgroups bool
		want      Verdict
		reason    string
	}{
		{
			"owner creates subgroups",
			&fakeGitLab{account: &gitlab.Account{ID: 1}, access: gitlab.AccessOwner},
			true, VerdictOK, "",
		},
		{
			// The case the issue names: the flag is on, the role is not, and the
			// first order of a new team is where anybody finds out.
			"maintainer cannot create subgroups",
			&fakeGitLab{account: &gitlab.Account{ID: 1}, access: gitlab.AccessMaintainer},
			true, VerdictFail, reasonNeedsOwner,
		},
		{
			"maintainer is enough when subgroups are provisioned elsewhere",
			&fakeGitLab{account: &gitlab.Account{ID: 1}, access: gitlab.AccessMaintainer},
			false, VerdictOK, "",
		},
		{
			"developer cannot create repositories",
			&fakeGitLab{account: &gitlab.Account{ID: 1}, access: 30},
			false, VerdictFail, reasonNeedsMaint,
		},
		{
			"not a member",
			&fakeGitLab{account: &gitlab.Account{ID: 1}, accessErr: models.ErrNotFound},
			false, VerdictFail, reasonNotMember,
		},
		{
			// An instance administrator is above membership and usually not a
			// member at all, so the members API proves nothing about them.
			"instance admin",
			&fakeGitLab{account: &gitlab.Account{ID: 1, IsAdmin: true}, accessErr: models.ErrNotFound},
			true, VerdictOK, "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := gitlabGroupAccess(context.Background(), tc.api, "managed-services", tc.subgroups)
			if got.Verdict != tc.want || got.Reason != tc.reason {
				t.Fatalf("got %s/%s, want %s/%s", got.Verdict, got.Reason, tc.want, tc.reason)
			}
		})
	}
}

func TestGitLabHook(t *testing.T) {
	const hookURL = "https://portal.example.com/api/v1/webhooks/gitlab"
	cfg := &config.Config{
		GitLabWebhookURL: hookURL, GitLabWebhookToken: "s",
		GitLabWebhookScope: "auto", GitLabGitopsGroup: "managed-services",
	}
	live := gitlab.HookInfo{ID: 7, URL: hookURL, MergeRequestsEvents: true, AlertStatus: "executable"}

	t.Run("group hook registered", func(t *testing.T) {
		api := &fakeGitLab{groupHooks: []gitlab.HookInfo{live}}
		if got := gitlabHook(context.Background(), cfg, api, scopeOf(gitlab.HookScopeGroup)); got.Verdict != VerdictOK {
			t.Fatalf("got %s/%s, want ok", got.Verdict, got.Reason)
		}
	})
	t.Run("nothing registered", func(t *testing.T) {
		got := gitlabHook(context.Background(), cfg, &fakeGitLab{}, scopeOf(gitlab.HookScopeNone))
		if got.Verdict != VerdictFail || got.Reason != reasonNotRegistered {
			t.Fatalf("got %s/%s, want fail/%s", got.Verdict, got.Reason, reasonNotRegistered)
		}
	})
	t.Run("scope resolved but the hook is gone", func(t *testing.T) {
		got := gitlabHook(context.Background(), cfg, &fakeGitLab{}, scopeOf(gitlab.HookScopeGroup))
		if got.Verdict != VerdictFail || got.Reason != reasonHookMissing {
			t.Fatalf("got %s/%s, want fail/%s", got.Verdict, got.Reason, reasonHookMissing)
		}
	})
	t.Run("gitlab switched the hook off", func(t *testing.T) {
		off := live
		off.AlertStatus = "disabled"
		api := &fakeGitLab{groupHooks: []gitlab.HookInfo{off}}
		got := gitlabHook(context.Background(), cfg, api, scopeOf(gitlab.HookScopeGroup))
		if got.Verdict != VerdictFail || got.Reason != reasonHookDisabled {
			t.Fatalf("got %s/%s, want fail/%s", got.Verdict, got.Reason, reasonHookDisabled)
		}
	})
	t.Run("subscribed to the wrong events", func(t *testing.T) {
		wrong := live
		wrong.MergeRequestsEvents = false
		api := &fakeGitLab{groupHooks: []gitlab.HookInfo{wrong}}
		got := gitlabHook(context.Background(), cfg, api, scopeOf(gitlab.HookScopeGroup))
		if got.Verdict != VerdictFail || got.Reason != reasonHookNotMR {
			t.Fatalf("got %s/%s, want fail/%s", got.Verdict, got.Reason, reasonHookNotMR)
		}
	})
	t.Run("per-repository, all covered", func(t *testing.T) {
		api := &fakeGitLab{
			projects:  []gitlab.Project{{ID: 1}, {ID: 2}},
			projHooks: map[int][]gitlab.HookInfo{1: {live}, 2: {live}},
		}
		got := gitlabHook(context.Background(), cfg, api, scopeOf(gitlab.HookScopeProject))
		if got.Verdict != VerdictOK {
			t.Fatalf("got %s/%s, want ok", got.Verdict, got.Reason)
		}
		if got.Facts["covered"] != "2" {
			t.Fatalf("covered = %q, want 2", got.Facts["covered"])
		}
	})
	t.Run("per-repository, one repository left out", func(t *testing.T) {
		api := &fakeGitLab{
			projects:  []gitlab.Project{{ID: 1}, {ID: 2}},
			projHooks: map[int][]gitlab.HookInfo{1: {live}},
		}
		got := gitlabHook(context.Background(), cfg, api, scopeOf(gitlab.HookScopeProject))
		if got.Verdict != VerdictWarn || got.Reason != reasonPartialHooks {
			t.Fatalf("got %s/%s, want warn/%s", got.Verdict, got.Reason, reasonPartialHooks)
		}
		if got.Facts["uncovered"] != "1" {
			t.Fatalf("uncovered = %q, want 1", got.Facts["uncovered"])
		}
	})
	t.Run("not configured", func(t *testing.T) {
		got := gitlabHook(context.Background(), &config.Config{}, &fakeGitLab{}, scopeOf(gitlab.HookScopeNone))
		if got.Verdict != VerdictSkip {
			t.Fatalf("got %s, want skip", got.Verdict)
		}
	})
}

func TestDeliveryCheck(t *testing.T) {
	since := time.Now().Add(-time.Hour)
	cases := []struct {
		name       string
		counts     DeliveryCounts
		configured bool
		want       Verdict
		reason     string
	}{
		{"not configured", DeliveryCounts{}, false, VerdictSkip, ReasonNotConfigured},
		{
			// The diagnosis the whole tracker exists for: neither side will show
			// its secret, but every delivery being refused says they differ.
			"every delivery refused",
			DeliveryCounts{Rejected: 7, Total: 7}, true, VerdictFail, reasonSecretMismatch,
		},
		{
			"some refused, some taken",
			DeliveryCounts{Accepted: 3, Rejected: 1, Total: 4}, true, VerdictWarn, reasonSomeRejected,
		},
		{
			"nothing has arrived yet, which is also what a quiet day looks like",
			DeliveryCounts{}, true, VerdictUnknown, reasonNoDeliveries,
		},
		{"arriving and accepted", DeliveryCounts{Accepted: 2, Total: 2}, true, VerdictOK, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d := fakeDeliveries{counts: map[string]DeliveryCounts{"gitlab": tc.counts}, since: since}
			got := deliveryCheck(d, "gitlab", tc.configured)
			if got.Verdict != tc.want || got.Reason != tc.reason {
				t.Fatalf("got %s/%s, want %s/%s", got.Verdict, got.Reason, tc.want, tc.reason)
			}
		})
	}
}

// --- Harbor ------------------------------------------------------------------

type fakeHarbor struct {
	repos     map[string][]harbor.RepoRef
	repoErr   map[string]error
	artifacts int
	artErr    error
	policies  map[string][]harbor.WebhookPolicy
	polErr    map[string]error
}

func (f *fakeHarbor) ListRepositories(_ context.Context, project string) ([]harbor.RepoRef, error) {
	if err := f.repoErr[project]; err != nil {
		return nil, err
	}
	return f.repos[project], nil
}
func (f *fakeHarbor) CountArtifacts(context.Context, string, string) (int, error) {
	return f.artifacts, f.artErr
}
func (f *fakeHarbor) ListWebhookPolicies(_ context.Context, project string) ([]harbor.WebhookPolicy, error) {
	if err := f.polErr[project]; err != nil {
		return nil, err
	}
	return f.policies[project], nil
}

func TestHarborProjects(t *testing.T) {
	projects := []string{"platform", "managed-services"}
	t.Run("all readable", func(t *testing.T) {
		api := &fakeHarbor{repos: map[string][]harbor.RepoRef{
			"platform":         {{Project: "platform", Name: "postgres"}},
			"managed-services": {{Project: "managed-services", Name: "redis"}},
		}}
		if got := harborProjects(context.Background(), api, projects); got.Verdict != VerdictOK {
			t.Fatalf("got %s/%s, want ok", got.Verdict, got.Reason)
		}
	})
	t.Run("one project is not there", func(t *testing.T) {
		api := &fakeHarbor{
			repos:   map[string][]harbor.RepoRef{"platform": {{Project: "platform", Name: "postgres"}}},
			repoErr: map[string]error{"managed-services": models.ErrNotFound},
		}
		got := harborProjects(context.Background(), api, projects)
		if got.Verdict != VerdictFail || got.Reason != reasonProjectsMissing {
			t.Fatalf("got %s/%s, want fail/%s", got.Verdict, got.Reason, reasonProjectsMissing)
		}
		if got.Facts["missing"] != "managed-services" {
			t.Fatalf("missing = %q", got.Facts["missing"])
		}
	})
	t.Run("nothing configured", func(t *testing.T) {
		if got := harborProjects(context.Background(), &fakeHarbor{}, nil); got.Verdict != VerdictFail {
			t.Fatalf("got %s, want fail", got.Verdict)
		}
	})
}

func TestHarborHook(t *testing.T) {
	cfg := &config.Config{
		PublicURL: "https://portal.example.com", HarborWebhookKey: "s",
		HarborProjects: []string{"platform"},
	}
	want := "https://portal.example.com" + HarborWebhookPath
	policy := func(enabled bool, events ...string) harbor.WebhookPolicy {
		p := harbor.WebhookPolicy{Name: "portal", Enabled: enabled, EventTypes: events}
		p.Targets = append(p.Targets, struct {
			Address string `json:"address"`
			Type    string `json:"type"`
		}{Address: want, Type: "http"})
		return p
	}
	cases := []struct {
		name   string
		api    *fakeHarbor
		want   Verdict
		reason string
	}{
		{
			"a policy aimed at the portal",
			&fakeHarbor{policies: map[string][]harbor.WebhookPolicy{"platform": {policy(true, pushArtifactEvent)}}},
			VerdictOK, "",
		},
		{
			// The case the issue names: the portal holds a secret and assumes the
			// other half exists. Nothing contradicts that until a chart is pushed.
			"the portal has a secret and Harbor has no policy",
			&fakeHarbor{},
			VerdictFail, reasonNoPolicy,
		},
		{
			"policy switched off",
			&fakeHarbor{policies: map[string][]harbor.WebhookPolicy{"platform": {policy(false, pushArtifactEvent)}}},
			VerdictFail, reasonPolicyDisabled,
		},
		{
			"policy not subscribed to a pushed chart",
			&fakeHarbor{policies: map[string][]harbor.WebhookPolicy{"platform": {policy(true, "DELETE_ARTIFACT")}}},
			VerdictWarn, reasonMissingEvent,
		},
		{
			"a read-only robot may not read the policies",
			&fakeHarbor{polErr: map[string]error{"platform": errors.New("403")}},
			VerdictUnknown, ReasonForbidden,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := harborHook(context.Background(), cfg, tc.api)
			if got.Verdict != tc.want || got.Reason != tc.reason {
				t.Fatalf("got %s/%s, want %s/%s", got.Verdict, got.Reason, tc.want, tc.reason)
			}
		})
	}
	t.Run("no secret means nothing to check", func(t *testing.T) {
		got := harborHook(context.Background(), &config.Config{}, &fakeHarbor{})
		if got.Verdict != VerdictSkip {
			t.Fatalf("got %s, want skip", got.Verdict)
		}
	})
}

// --- Argo CD -----------------------------------------------------------------

type fakeArgo struct {
	projectExists bool
	projectErr    error
	clusters      []argocd.Cluster
	clusterErr    error
	can           map[string]bool
	canErr        error
	namespace     string
	namespaceErr  error
}

func (f *fakeArgo) ProjectExists(context.Context, string) (bool, error) {
	return f.projectExists, f.projectErr
}
func (f *fakeArgo) ListClusters(context.Context) ([]argocd.Cluster, error) {
	return f.clusters, f.clusterErr
}
func (f *fakeArgo) CanI(_ context.Context, _, action, _ string) (bool, error) {
	return f.can[action], f.canErr
}
func (f *fakeArgo) ApplicationNamespace(context.Context) (string, error) {
	return f.namespace, f.namespaceErr
}

func TestArgoChecks(t *testing.T) {
	t.Run("project missing", func(t *testing.T) {
		got := argoProject(context.Background(), &fakeArgo{}, "portal-managed")
		if got.Verdict != VerdictFail || got.Reason != reasonProjectMissing {
			t.Fatalf("got %s/%s", got.Verdict, got.Reason)
		}
	})
	t.Run("project there", func(t *testing.T) {
		got := argoProject(context.Background(), &fakeArgo{projectExists: true}, "portal-managed")
		if got.Verdict != VerdictOK {
			t.Fatalf("got %s/%s", got.Verdict, got.Reason)
		}
	})
	t.Run("cluster registered by name", func(t *testing.T) {
		api := &fakeArgo{clusters: []argocd.Cluster{{Name: "in-cluster", Server: "https://kubernetes.default.svc"}}}
		if got := argoCluster(context.Background(), api, "in-cluster"); got.Verdict != VerdictOK {
			t.Fatalf("got %s/%s", got.Verdict, got.Reason)
		}
	})
	t.Run("cluster registered by server address", func(t *testing.T) {
		api := &fakeArgo{clusters: []argocd.Cluster{{Name: "in-cluster", Server: "https://kubernetes.default.svc"}}}
		if got := argoCluster(context.Background(), api, "https://kubernetes.default.svc"); got.Verdict != VerdictOK {
			t.Fatalf("got %s/%s", got.Verdict, got.Reason)
		}
	})
	t.Run("cluster not registered", func(t *testing.T) {
		api := &fakeArgo{clusters: []argocd.Cluster{{Name: "in-cluster"}}}
		got := argoCluster(context.Background(), api, "prod")
		if got.Verdict != VerdictFail || got.Reason != reasonClusterMissing {
			t.Fatalf("got %s/%s", got.Verdict, got.Reason)
		}
	})
	t.Run("cannot read applications", func(t *testing.T) {
		got := argoPermissions(context.Background(), &fakeArgo{can: map[string]bool{}}, "portal-managed")
		if got.Verdict != VerdictFail || got.Reason != reasonCannotRead {
			t.Fatalf("got %s/%s", got.Verdict, got.Reason)
		}
	})
	t.Run("can read but not sync", func(t *testing.T) {
		api := &fakeArgo{can: map[string]bool{"get": true}}
		got := argoPermissions(context.Background(), api, "portal-managed")
		if got.Verdict != VerdictWarn || got.Reason != reasonCannotSync {
			t.Fatalf("got %s/%s", got.Verdict, got.Reason)
		}
	})
	t.Run("namespace matches", func(t *testing.T) {
		got := argoNamespace(context.Background(), &fakeArgo{namespace: "argocd"}, "argocd")
		if got.Verdict != VerdictOK {
			t.Fatalf("got %s/%s", got.Verdict, got.Reason)
		}
	})
	t.Run("applications committed where Argo CD does not look", func(t *testing.T) {
		got := argoNamespace(context.Background(), &fakeArgo{namespace: "argo-cd"}, "argocd")
		if got.Verdict != VerdictFail || got.Reason != reasonNamespaceDiff {
			t.Fatalf("got %s/%s", got.Verdict, got.Reason)
		}
	})
	t.Run("nothing deployed yet", func(t *testing.T) {
		got := argoNamespace(context.Background(), &fakeArgo{}, "argocd")
		if got.Verdict != VerdictSkip || got.Reason != reasonNoApplications {
			t.Fatalf("got %s/%s", got.Verdict, got.Reason)
		}
	})
}
