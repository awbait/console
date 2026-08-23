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

// GetGroup answers with a plausible group unless the test says otherwise, so a
// case about access levels does not have to state one.
func (f *fakeGitLab) GetGroup(context.Context, string) (*gitlab.Group, error) {
	if f.group == nil && f.groupErr == nil {
		return &gitlab.Group{ID: 12, FullPath: "managed-services"}, nil
	}
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
			VerdictOK, reasonTokenValid,
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

func TestGitLabGroup(t *testing.T) {
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
			true, VerdictOK, reasonRoleEnough,
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
			false, VerdictOK, reasonRoleEnough,
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
			true, VerdictOK, reasonRoleEnough,
		},
		{
			// Folded in from what used to be a check of its own: to whoever has
			// to fix it, a missing group and a role too low are one sentence.
			"the group is not there",
			&fakeGitLab{account: &gitlab.Account{ID: 1}, groupErr: models.ErrNotFound},
			false, VerdictFail, reasonGroupMissing,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := gitlabGroup(context.Background(), tc.api, "managed-services", tc.subgroups)
			if got.Verdict != tc.want || got.Reason != tc.reason {
				t.Fatalf("got %s/%s, want %s/%s", got.Verdict, got.Reason, tc.want, tc.reason)
			}
		})
	}
}

func TestGitLabWebhook(t *testing.T) {
	const hookURL = "https://portal.example.com/api/v1/webhooks/gitlab"
	cfg := func(mut func(*config.Config)) *config.Config {
		c := &config.Config{
			GitLabWebhookURL: hookURL, GitLabWebhookToken: "s",
			GitLabWebhookScope: "auto", GitLabGitopsGroup: "managed-services",
			PublicURL: "https://portal.example.com",
		}
		if mut != nil {
			mut(c)
		}
		return c
	}
	live := gitlab.HookInfo{ID: 7, URL: hookURL, MergeRequestsEvents: true, AlertStatus: "executable"}
	quiet := fakeDeliveries{since: time.Now().Add(-time.Hour)}
	delivered := func(c DeliveryCounts) fakeDeliveries {
		return fakeDeliveries{counts: map[string]DeliveryCounts{"gitlab": c}}
	}
	group := func(hooks ...gitlab.HookInfo) *fakeGitLab { return &fakeGitLab{groupHooks: hooks} }
	run := func(c *config.Config, api GitLabAPI, scope gitlab.HookScope, d Deliveries) Result {
		return gitlabWebhook(context.Background(), c, api, scopeOf(scope), d)
	}

	t.Run("registered and quiet", func(t *testing.T) {
		if got := run(cfg(nil), group(live), gitlab.HookScopeGroup, quiet); got.Verdict != VerdictOK {
			t.Fatalf("got %s/%s, want ok", got.Verdict, got.Reason)
		}
	})
	t.Run("nothing configured", func(t *testing.T) {
		empty := cfg(func(c *config.Config) { c.GitLabWebhookURL, c.GitLabWebhookToken = "", "" })
		if got := run(empty, group(), gitlab.HookScopeNone, quiet); got.Verdict != VerdictSkip {
			t.Fatalf("got %s, want skip", got.Verdict)
		}
	})
	t.Run("an address with no secret registers nothing", func(t *testing.T) {
		c := cfg(func(c *config.Config) { c.GitLabWebhookToken = "" })
		got := run(c, group(), gitlab.HookScopeNone, quiet)
		if got.Verdict != VerdictWarn || got.Reason != reasonURLWithoutToken {
			t.Fatalf("got %s/%s", got.Verdict, got.Reason)
		}
	})
	t.Run("a secret with no address is registered by hand or not at all", func(t *testing.T) {
		c := cfg(func(c *config.Config) { c.GitLabWebhookURL = "" })
		got := run(c, group(), gitlab.HookScopeNone, quiet)
		if got.Verdict != VerdictWarn || got.Reason != reasonTokenWithoutURL {
			t.Fatalf("got %s/%s", got.Verdict, got.Reason)
		}
	})
	t.Run("the address is not the portal's webhook endpoint", func(t *testing.T) {
		c := cfg(func(c *config.Config) { c.GitLabWebhookURL = "https://portal.example.com/hooks/gitlab" })
		got := run(c, group(live), gitlab.HookScopeGroup, quiet)
		if got.Verdict != VerdictFail || got.Reason != reasonPathMismatch {
			t.Fatalf("got %s/%s", got.Verdict, got.Reason)
		}
	})
	t.Run("nothing registered", func(t *testing.T) {
		got := run(cfg(nil), group(), gitlab.HookScopeNone, quiet)
		if got.Verdict != VerdictFail || got.Reason != reasonNotRegistered {
			t.Fatalf("got %s/%s", got.Verdict, got.Reason)
		}
	})
	t.Run("scope resolved but the hook is gone", func(t *testing.T) {
		got := run(cfg(nil), group(), gitlab.HookScopeGroup, quiet)
		if got.Verdict != VerdictFail || got.Reason != reasonHookMissing {
			t.Fatalf("got %s/%s", got.Verdict, got.Reason)
		}
	})
	t.Run("gitlab switched the hook off", func(t *testing.T) {
		off := live
		off.AlertStatus = "disabled"
		got := run(cfg(nil), group(off), gitlab.HookScopeGroup, quiet)
		if got.Verdict != VerdictFail || got.Reason != reasonHookDisabled {
			t.Fatalf("got %s/%s", got.Verdict, got.Reason)
		}
	})
	t.Run("subscribed to the wrong events", func(t *testing.T) {
		wrong := live
		wrong.MergeRequestsEvents = false
		got := run(cfg(nil), group(wrong), gitlab.HookScopeGroup, quiet)
		if got.Verdict != VerdictFail || got.Reason != reasonHookNotMR {
			t.Fatalf("got %s/%s", got.Verdict, got.Reason)
		}
	})
	t.Run("per-repository, all covered", func(t *testing.T) {
		api := &fakeGitLab{
			projects:  []gitlab.Project{{ID: 1}, {ID: 2}},
			projHooks: map[int][]gitlab.HookInfo{1: {live}, 2: {live}},
		}
		got := run(cfg(nil), api, gitlab.HookScopeProject, quiet)
		if got.Verdict != VerdictOK || got.Facts["covered"] != "2" {
			t.Fatalf("got %s/%s facts=%v", got.Verdict, got.Reason, got.Facts)
		}
	})
	t.Run("per-repository, one repository left out", func(t *testing.T) {
		api := &fakeGitLab{
			projects:  []gitlab.Project{{ID: 1}, {ID: 2}},
			projHooks: map[int][]gitlab.HookInfo{1: {live}},
		}
		got := run(cfg(nil), api, gitlab.HookScopeProject, quiet)
		if got.Verdict != VerdictWarn || got.Reason != reasonPartialHooks {
			t.Fatalf("got %s/%s", got.Verdict, got.Reason)
		}
		if got.Facts["uncovered"] != "1" {
			t.Fatalf("uncovered = %q, want 1", got.Facts["uncovered"])
		}
	})

	// Deliveries: the only place a secret mismatch is ever visible, since
	// neither side hands its copy back.
	t.Run("every delivery refused", func(t *testing.T) {
		d := delivered(DeliveryCounts{Rejected: 7, Total: 7, LastRejected: time.Now()})
		got := run(cfg(nil), group(live), gitlab.HookScopeGroup, d)
		if got.Verdict != VerdictFail || got.Reason != reasonSecretMismatch {
			t.Fatalf("got %s/%s", got.Verdict, got.Reason)
		}
	})
	t.Run("some refused, some taken", func(t *testing.T) {
		d := delivered(DeliveryCounts{Accepted: 3, Rejected: 1, Total: 4})
		got := run(cfg(nil), group(live), gitlab.HookScopeGroup, d)
		if got.Verdict != VerdictWarn || got.Reason != reasonSomeRejected {
			t.Fatalf("got %s/%s", got.Verdict, got.Reason)
		}
	})

	// Evidence outranks inference. GitLab reaching the portal by another name is
	// normal, and deliveries arriving prove it works, so the address looking odd
	// next to PUBLIC_URL is not worth a word.
	t.Run("a different host is fine while deliveries arrive", func(t *testing.T) {
		c := cfg(func(c *config.Config) { c.PublicURL = "http://localhost:8080" })
		d := delivered(DeliveryCounts{Accepted: 2, Total: 2, LastAccepted: time.Now()})
		if got := run(c, group(live), gitlab.HookScopeGroup, d); got.Verdict != VerdictOK {
			t.Fatalf("got %s/%s, want ok", got.Verdict, got.Reason)
		}
	})
	t.Run("a different host is worth a word while nothing arrives", func(t *testing.T) {
		c := cfg(func(c *config.Config) { c.PublicURL = "https://other.example.com" })
		got := run(c, group(live), gitlab.HookScopeGroup, quiet)
		if got.Verdict != VerdictWarn || got.Reason != reasonHostMismatch {
			t.Fatalf("got %s/%s", got.Verdict, got.Reason)
		}
	})
	t.Run("a different scheme is worth a word while nothing arrives", func(t *testing.T) {
		c := cfg(func(c *config.Config) { c.PublicURL = "http://portal.example.com" })
		got := run(c, group(live), gitlab.HookScopeGroup, quiet)
		if got.Verdict != VerdictWarn || got.Reason != reasonSchemeMismatch {
			t.Fatalf("got %s/%s", got.Verdict, got.Reason)
		}
	})
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

func TestHarborWebhook(t *testing.T) {
	cfg := &config.Config{
		PublicURL: "https://portal.example.com", HarborWebhookKey: "s",
		HarborProjects: []string{"platform"},
	}
	want := "https://portal.example.com" + HarborWebhookPath
	quiet := fakeDeliveries{since: time.Now().Add(-time.Hour)}
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
			VerdictOK, reasonPolicyFound,
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
			got := harborWebhook(context.Background(), cfg, tc.api, quiet)
			if got.Verdict != tc.want || got.Reason != tc.reason {
				t.Fatalf("got %s/%s, want %s/%s", got.Verdict, got.Reason, tc.want, tc.reason)
			}
		})
	}
	t.Run("no secret means nothing to check", func(t *testing.T) {
		got := harborWebhook(context.Background(), &config.Config{}, &fakeHarbor{}, quiet)
		if got.Verdict != VerdictSkip {
			t.Fatalf("got %s, want skip", got.Verdict)
		}
	})
	t.Run("every delivery refused", func(t *testing.T) {
		d := fakeDeliveries{counts: map[string]DeliveryCounts{
			"harbor": {Rejected: 4, Total: 4, LastRejected: time.Now()},
		}}
		got := harborWebhook(context.Background(), cfg, &fakeHarbor{}, d)
		if got.Verdict != VerdictFail || got.Reason != reasonSecretMismatch {
			t.Fatalf("got %s/%s", got.Verdict, got.Reason)
		}
	})
	t.Run("deliveries arriving beat an unreadable policy list", func(t *testing.T) {
		// A read-only robot cannot see the policies, but the deliveries prove
		// both that a policy exists and that the secrets match.
		api := &fakeHarbor{polErr: map[string]error{"platform": harbor.ErrAccessDenied}}
		d := fakeDeliveries{counts: map[string]DeliveryCounts{
			"harbor": {Accepted: 2, Total: 2, LastAccepted: time.Now()},
		}}
		if got := harborWebhook(context.Background(), cfg, api, d); got.Verdict != VerdictOK {
			t.Fatalf("got %s/%s, want ok", got.Verdict, got.Reason)
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
	t.Run("nothing deployed yet, so nothing to compare and nothing to say", func(t *testing.T) {
		got := argoNamespace(context.Background(), &fakeArgo{}, "argocd")
		if got.Verdict != VerdictSilent || got.Reason != reasonNoApplications {
			t.Fatalf("got %s/%s", got.Verdict, got.Reason)
		}
	})
}
