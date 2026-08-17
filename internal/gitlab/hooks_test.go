package gitlab_test

import (
	"context"
	"errors"
	"testing"

	"console/internal/gitlab"
)

const gitopsGroup = "managed-services"

func testHook() gitlab.Hook {
	return gitlab.Hook{URL: "https://portal.local/api/v1/webhooks/gitlab", Token: "s3cret"}
}

// seedRepos creates repos under the group, as the portal would.
func seedRepos(ctx context.Context, t *testing.T, f *gitlab.Fake, names ...string) []int {
	t.Helper()
	sg, err := f.GetGroup(ctx, gitopsGroup+"/team-core")
	if err != nil {
		t.Fatalf("get subgroup: %v", err)
	}
	var ids []int
	for _, n := range names {
		p, err := f.CreateProject(ctx, sg.ID, n)
		if err != nil {
			t.Fatalf("create repo %s: %v", n, err)
		}
		ids = append(ids, p.ID)
	}
	return ids
}

func newHookFake(t *testing.T, group, system bool) *gitlab.Fake {
	t.Helper()
	f := gitlab.NewFake(gitopsGroup, []string{"team-core"}, false)
	f.SetHookAvailability(group, system)
	return f
}

// TestHookScopeCascade: auto picks the widest scope the instance allows, and
// stops at the first that works.
func TestHookScopeCascade(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name           string
		group, system  bool
		want           gitlab.HookScope
		wantGroupHook  bool
		wantSystemHook bool
		wantProjects   int
	}{
		{name: "premium instance", group: true, system: true, want: gitlab.HookScopeGroup, wantGroupHook: true},
		{name: "free tier, admin token", system: true, want: gitlab.HookScopeSystem, wantSystemHook: true},
		{name: "free tier, plain token", want: gitlab.HookScopeProject, wantProjects: 2},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newHookFake(t, tc.group, tc.system)
			seedRepos(ctx, t, f, "postgres", "redis")
			m := gitlab.NewHookManager(f, gitopsGroup, testHook(), gitlab.HookScopeAuto, nil)

			scope, err := m.Ensure(ctx)
			if err != nil {
				t.Fatalf("ensure: %v", err)
			}
			if scope != tc.want {
				t.Fatalf("scope = %q, want %q", scope, tc.want)
			}
			if scope != m.Scope() {
				t.Fatalf("Scope() = %q, want %q", m.Scope(), scope)
			}
			g, s, projects := f.Hooks()
			if (g != nil) != tc.wantGroupHook {
				t.Fatalf("group hook present = %v, want %v", g != nil, tc.wantGroupHook)
			}
			if (s != nil) != tc.wantSystemHook {
				t.Fatalf("system hook present = %v, want %v", s != nil, tc.wantSystemHook)
			}
			if len(projects) != tc.wantProjects {
				t.Fatalf("project hooks = %d, want %d", len(projects), tc.wantProjects)
			}
		})
	}
}

// The per-project sweep covers repos that already exist, so switching the
// webhook on does not need a separate backfill.
func TestHookProjectScopeSweepsExistingRepos(t *testing.T) {
	ctx := context.Background()
	f := newHookFake(t, false, false)
	ids := seedRepos(ctx, t, f, "postgres", "redis")
	m := gitlab.NewHookManager(f, gitopsGroup, testHook(), gitlab.HookScopeAuto, nil)

	if _, err := m.Ensure(ctx); err != nil {
		t.Fatalf("ensure: %v", err)
	}
	_, _, projects := f.Hooks()
	for _, id := range ids {
		h, ok := projects[id]
		if !ok {
			t.Fatalf("project %d has no hook", id)
		}
		if h.Token != testHook().Token || h.URL != testHook().URL {
			t.Fatalf("project %d hook = %+v, want %+v", id, h, testHook())
		}
	}
}

// A repo created after startup is hooked under the project scope, and needs no
// hook of its own under the wider ones.
func TestHookEnsureProject(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name          string
		group, system bool
		wantHook      bool
	}{
		{name: "project scope hooks the new repo", wantHook: true},
		{name: "system scope already covers it", system: true},
		{name: "group scope already covers it", group: true, system: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newHookFake(t, tc.group, tc.system)
			m := gitlab.NewHookManager(f, gitopsGroup, testHook(), gitlab.HookScopeAuto, nil)
			if _, err := m.Ensure(ctx); err != nil {
				t.Fatalf("ensure: %v", err)
			}
			ids := seedRepos(ctx, t, f, "kafka") // created after the startup sweep
			if err := m.EnsureProject(ctx, ids[0]); err != nil {
				t.Fatalf("ensure project: %v", err)
			}
			_, _, projects := f.Hooks()
			if _, ok := projects[ids[0]]; ok != tc.wantHook {
				t.Fatalf("project hook present = %v, want %v", ok, tc.wantHook)
			}
		})
	}
}

// A pinned scope is not a preference: if the instance cannot do it, the portal
// says so instead of quietly registering a narrower hook.
func TestHookPinnedScopeDoesNotFallBack(t *testing.T) {
	ctx := context.Background()
	f := newHookFake(t, false, false)
	seedRepos(ctx, t, f, "postgres")
	m := gitlab.NewHookManager(f, gitopsGroup, testHook(), gitlab.HookScopeGroup, nil)

	scope, err := m.Ensure(ctx)
	if err == nil {
		t.Fatalf("want an error, got scope %q", scope)
	}
	if scope != gitlab.HookScopeNone {
		t.Fatalf("scope = %q, want %q", scope, gitlab.HookScopeNone)
	}
	if _, _, projects := f.Hooks(); len(projects) != 0 {
		t.Fatalf("registered %d project hooks despite the pinned scope", len(projects))
	}
}

// Startup can lose the race with a GitLab that is not up yet. The next repo the
// portal creates retries the resolution instead of staying unhooked.
func TestHookEnsureProjectRetriesUnresolved(t *testing.T) {
	ctx := context.Background()
	f := newHookFake(t, false, false)
	m := gitlab.NewHookManager(f, gitopsGroup, testHook(), gitlab.HookScopeGroup, nil)
	if _, err := m.Ensure(ctx); err == nil {
		t.Fatal("want the group scope to fail on this fake")
	}

	f.SetHookAvailability(true, false) // instance licensed in the meantime
	ids := seedRepos(ctx, t, f, "postgres")
	if err := m.EnsureProject(ctx, ids[0]); err != nil {
		t.Fatalf("ensure project: %v", err)
	}
	if g, _, _ := f.Hooks(); g == nil {
		t.Fatal("group hook was not registered on retry")
	}
	if m.Scope() != gitlab.HookScopeGroup {
		t.Fatalf("scope = %q, want %q", m.Scope(), gitlab.HookScopeGroup)
	}
}

// Registration is idempotent: rerunning it rewrites the same hook.
func TestHookEnsureIsIdempotent(t *testing.T) {
	ctx := context.Background()
	f := newHookFake(t, false, false)
	ids := seedRepos(ctx, t, f, "postgres")
	m := gitlab.NewHookManager(f, gitopsGroup, testHook(), gitlab.HookScopeAuto, nil)

	for range 3 {
		if _, err := m.Ensure(ctx); err != nil {
			t.Fatalf("ensure: %v", err)
		}
	}
	_, _, projects := f.Hooks()
	if len(projects) != len(ids) {
		t.Fatalf("project hooks = %d, want %d", len(projects), len(ids))
	}
}

// A portal with no webhook configured carries a nil manager; it must be inert
// rather than a panic waiting for the first order.
func TestNilHookManagerIsInert(t *testing.T) {
	ctx := context.Background()
	var m *gitlab.HookManager
	scope, err := m.Ensure(ctx)
	if err != nil || scope != gitlab.HookScopeNone {
		t.Fatalf("ensure on nil manager = (%q, %v), want (%q, nil)", scope, err, gitlab.HookScopeNone)
	}
	if err := m.EnsureProject(ctx, 1); err != nil {
		t.Fatalf("ensure project on nil manager: %v", err)
	}
	if m.Scope() != gitlab.HookScopeNone {
		t.Fatalf("scope = %q, want %q", m.Scope(), gitlab.HookScopeNone)
	}
}

// The unavailable-scope signal must stay distinguishable from a real failure:
// the cascade only moves on for the former.
func TestScopeUnavailableIsDistinct(t *testing.T) {
	ctx := context.Background()
	f := newHookFake(t, false, false)
	if err := f.EnsureGroupHook(ctx, gitopsGroup, testHook()); !errors.Is(err, gitlab.ErrScopeUnavailable) {
		t.Fatalf("group hook error = %v, want ErrScopeUnavailable", err)
	}
	if err := f.EnsureSystemHook(ctx, testHook()); !errors.Is(err, gitlab.ErrScopeUnavailable) {
		t.Fatalf("system hook error = %v, want ErrScopeUnavailable", err)
	}
}
