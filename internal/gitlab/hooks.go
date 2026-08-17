package gitlab

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"

	"console/pkg/models"
)

// Hook is the merge-request webhook the portal asks GitLab to deliver to it.
// The same hook is registered whatever the scope: only the coverage differs.
type Hook struct {
	URL       string // where GitLab POSTs, e.g. https://portal.example.com/api/v1/webhooks/gitlab
	Token     string // shared secret GitLab sends back in X-Gitlab-Token
	SSLVerify bool   // verify the portal's certificate (meaningless for an http:// URL)
}

// HookScope is where the webhook is registered, which decides what it covers.
// Group and system hooks cover repositories created later on their own; project
// hooks have to be registered per repository as it is created.
type HookScope string

const (
	// HookScopeAuto picks the widest scope the instance actually allows.
	HookScopeAuto HookScope = "auto"
	// HookScopeGroup is one hook on the GitOps group. Premium/Ultimate only,
	// and the token needs Owner on that group (or admin).
	HookScopeGroup HookScope = "group"
	// HookScopeSystem is one hook on the whole instance. Available on Free but
	// the token has to belong to an instance administrator.
	HookScopeSystem HookScope = "system"
	// HookScopeProject is a hook per repository. Works on any tier with a plain
	// maintainer token, at the price of registering one per repository.
	HookScopeProject HookScope = "project"
	// HookScopeNone means nothing is registered (no scope worked, or the
	// webhook is not configured at all).
	HookScopeNone HookScope = "none"
)

// ValidHookScope reports whether s is a scope the manager accepts.
func ValidHookScope(s HookScope) bool {
	switch s {
	case HookScopeAuto, HookScopeGroup, HookScopeSystem, HookScopeProject:
		return true
	}
	return false
}

// ErrScopeUnavailable means this instance cannot register a hook at that scope:
// the tier does not include it, or the token lacks the role. It is not a
// failure - it is the signal to try a narrower scope.
var ErrScopeUnavailable = errors.New("gitlab: webhook scope unavailable")

// payload is the create/update body, identical for all three scopes. Only merge
// requests are subscribed: the portal reacts to an MR reaching a terminal state
// and ignores everything else (see internal/webhooks). The other event types are
// turned off explicitly rather than left out - a system hook defaults
// repository_update_events on, and every one of those deliveries would be a
// round trip the portal answers with "ignored".
func (h Hook) payload() map[string]any {
	return map[string]any{
		"url":                      h.URL,
		"token":                    h.Token,
		"merge_requests_events":    true,
		"push_events":              false,
		"tag_push_events":          false,
		"repository_update_events": false,
		"enable_ssl_verification":  h.SSLVerify,
	}
}

// hookRef is the part of GitLab's hook representation we match on. The token is
// never returned by the API, so an existing hook is always rewritten in place
// rather than compared field by field.
type hookRef struct {
	ID  int    `json:"id"`
	URL string `json:"url"`
}

// ensureHook creates the hook under a collection path, or updates the one that
// already points at the same URL. Group, system and project hooks share the
// shape (GET lists, POST creates, PUT <id> updates), so one method covers all
// three. Idempotent: a rerun rewrites the hook instead of adding a duplicate.
func (c *Client) ensureHook(ctx context.Context, base string, h Hook) error {
	var existing []hookRef
	if err := c.do(ctx, http.MethodGet, base, nil, nil, &existing); err != nil {
		return err
	}
	for _, e := range existing {
		if e.URL == h.URL {
			return c.do(ctx, http.MethodPut, fmt.Sprintf("%s/%d", base, e.ID), nil, h.payload(), nil)
		}
	}
	return c.do(ctx, http.MethodPost, base, nil, h.payload(), nil)
}

// EnsureGroupHook registers the hook on the GitOps group (Premium+). A missing
// group is a configuration error and surfaces as such; a 403/404 from the hooks
// endpoint of a group that does exist means the feature is not available here,
// which maps to ErrScopeUnavailable.
func (c *Client) EnsureGroupHook(ctx context.Context, groupPath string, h Hook) error {
	g, err := c.GetGroup(ctx, groupPath)
	if err != nil {
		return fmt.Errorf("gitlab: group %q: %w", groupPath, err)
	}
	return asScopeUnavailable(c.ensureHook(ctx, fmt.Sprintf("/groups/%d/hooks", g.ID), h))
}

// EnsureSystemHook registers the hook instance-wide. Free tier, admin only.
func (c *Client) EnsureSystemHook(ctx context.Context, h Hook) error {
	return asScopeUnavailable(c.ensureHook(ctx, "/hooks", h))
}

// EnsureProjectHook registers the hook on one repository.
func (c *Client) EnsureProjectHook(ctx context.Context, projectID int, h Hook) error {
	return c.ensureHook(ctx, fmt.Sprintf("/projects/%d/hooks", projectID), h)
}

// ListGroupProjects lists every repository under the GitOps group, including
// subgroups. Used to register per-repository hooks on repos that already exist.
func (c *Client) ListGroupProjects(ctx context.Context) ([]Project, error) {
	if c.gitopsGroup == "" {
		return nil, nil
	}
	return c.listGroupProjects(ctx, c.gitopsGroup)
}

// asScopeUnavailable translates "you may not do this here" into
// ErrScopeUnavailable. GitLab answers 404 for a feature the tier does not
// include (it hides it rather than admitting it exists) and 401/403 when the
// token's role is too low; everything else is a genuine error.
func asScopeUnavailable(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, models.ErrNotFound) {
		return fmt.Errorf("%w: not found (feature not in this tier)", ErrScopeUnavailable)
	}
	var ae *apiError
	if errors.As(err, &ae) && (ae.status == http.StatusUnauthorized || ae.status == http.StatusForbidden) {
		return fmt.Errorf("%w: status %d (token role too low)", ErrScopeUnavailable, ae.status)
	}
	return err
}

// HookAPI is the slice of GitLab that HookManager drives. *Client implements
// it; the fake does too, so the cascade is testable without a GitLab.
type HookAPI interface {
	EnsureGroupHook(ctx context.Context, groupPath string, h Hook) error
	EnsureSystemHook(ctx context.Context, h Hook) error
	EnsureProjectHook(ctx context.Context, projectID int, h Hook) error
	ListGroupProjects(ctx context.Context) ([]Project, error)
}

// HookManager keeps the portal's own merge-request webhook registered in
// GitLab, so nobody has to add it by hand after deploying or after ordering a
// service.
//
// It resolves one scope at startup, widest first: a group hook, else a system
// hook, else a hook per repository. The first two cover repositories created
// later by themselves; the third does not, so under it every repository the
// portal creates gets its own hook at creation time, and the ones that already
// exist are covered by a sweep at startup.
//
// A nil *HookManager is usable and does nothing, which is what a portal with no
// webhook configured gets.
type HookManager struct {
	api   HookAPI
	group string
	hook  Hook
	want  HookScope
	log   *slog.Logger

	mu       sync.Mutex
	scope    HookScope
	resolved bool
}

// NewHookManager builds a manager. want pins the scope (HookScopeAuto tries all
// three); group is the GitOps group a group hook would be registered on.
func NewHookManager(api HookAPI, group string, h Hook, want HookScope, log *slog.Logger) *HookManager {
	if want == "" {
		want = HookScopeAuto
	}
	return &HookManager{api: api, group: group, hook: h, want: want, log: log, scope: HookScopeNone}
}

// Scope returns the scope in use, or HookScopeNone before a successful Ensure.
func (m *HookManager) Scope() HookScope {
	if m == nil {
		return HookScopeNone
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.scope
}

// Ensure registers the webhook at the widest scope available and reports which
// one that was. Safe to call repeatedly: every scope is idempotent.
func (m *HookManager) Ensure(ctx context.Context) (HookScope, error) {
	if m == nil {
		return HookScopeNone, nil
	}
	order := []HookScope{HookScopeGroup, HookScopeSystem, HookScopeProject}
	if m.want != HookScopeAuto {
		order = []HookScope{m.want}
	}
	var attempts []string
	for _, s := range order {
		err := m.register(ctx, s)
		if err == nil {
			m.mu.Lock()
			m.scope, m.resolved = s, true
			m.mu.Unlock()
			m.logger().Info("gitlab webhook registered", "scope", string(s), "url", m.hook.URL)
			return s, nil
		}
		if !errors.Is(err, ErrScopeUnavailable) {
			return HookScopeNone, fmt.Errorf("gitlab webhook (%s): %w", s, err)
		}
		m.logger().Debug("gitlab webhook scope unavailable", "scope", string(s), "err", err)
		attempts = append(attempts, fmt.Sprintf("%s: %v", s, err))
	}
	return HookScopeNone, fmt.Errorf("gitlab webhook: no usable scope (%s)", strings.Join(attempts, "; "))
}

// EnsureProject registers the hook on a freshly created repository. It is a
// no-op unless the resolved scope is per-repository: a group or system hook
// already covers the new repo. Callers must not fail an order over its error -
// a missing webhook only delays the reaction until the next poll.
func (m *HookManager) EnsureProject(ctx context.Context, projectID int) error {
	if m == nil {
		return nil
	}
	// Startup registration can fail against a GitLab that was not up yet. Retry
	// it here rather than leaving the portal unhooked until the next restart.
	m.mu.Lock()
	resolved, scope := m.resolved, m.scope
	m.mu.Unlock()
	if !resolved {
		var err error
		if scope, err = m.Ensure(ctx); err != nil {
			return err
		}
	}
	if scope != HookScopeProject {
		return nil
	}
	return m.api.EnsureProjectHook(ctx, projectID, m.hook)
}

// register applies one scope. The project scope also sweeps the repositories
// that already exist, so turning the webhook on covers a populated GitLab
// without a separate backfill step.
func (m *HookManager) register(ctx context.Context, s HookScope) error {
	switch s {
	case HookScopeGroup:
		return m.api.EnsureGroupHook(ctx, m.group, m.hook)
	case HookScopeSystem:
		return m.api.EnsureSystemHook(ctx, m.hook)
	case HookScopeProject:
		projects, err := m.api.ListGroupProjects(ctx)
		if err != nil {
			return err
		}
		for _, p := range projects {
			if err := m.api.EnsureProjectHook(ctx, p.ID, m.hook); err != nil {
				return fmt.Errorf("project %s: %w", p.PathWithNamespace, err)
			}
		}
		m.logger().Debug("gitlab webhook per-project sweep", "projects", len(projects))
		return nil
	default:
		return fmt.Errorf("unknown webhook scope %q", s)
	}
}

func (m *HookManager) logger() *slog.Logger {
	if m.log != nil {
		return m.log
	}
	return slog.Default()
}
