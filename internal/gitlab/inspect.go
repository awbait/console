package gitlab

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"console/pkg/models"
)

// Read-only calls the configuration checks use (internal/checks) to answer "is
// this portal actually wired to this GitLab", as opposed to "does GitLab
// answer". Nothing here creates or changes anything: the whole point of the
// check set is that it can run against production without leaving a trace.
//
// The one exception is TestHook, which asks GitLab to send the portal a sample
// delivery. It writes nothing either, but it is an outbound call GitLab makes on
// our behalf, so it runs only when a person presses the button.

// Account is the GitLab user the portal's token belongs to.
type Account struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
	IsAdmin  bool   `json:"is_admin"` // only present when the token is an admin's
}

// CurrentUser returns the account behind GITLAB_TOKEN. It is also the cheapest
// proof that the token is valid at all.
func (c *Client) CurrentUser(ctx context.Context) (*Account, error) {
	var a Account
	if err := c.do(ctx, http.MethodGet, "/user", nil, nil, &a); err != nil {
		return nil, err
	}
	return &a, nil
}

// TokenInfo is what GitLab says about the token being used, from the token's
// own endpoint. ExpiresAt is a bare date ("2026-09-01") or empty for a token
// that never expires.
type TokenInfo struct {
	Name      string   `json:"name"`
	Scopes    []string `json:"scopes"`
	ExpiresAt string   `json:"expires_at"`
	Active    bool     `json:"active"`
	Revoked   bool     `json:"revoked"`
}

// ErrTokenIntrospectionUnavailable means this GitLab will not describe the token
// to itself: /personal_access_tokens/self exists since 14.10 and answers only
// for a personal access token, so a group or project token (or an older
// instance) returns 401/404 here. Not a failure - just a thing we cannot see.
var ErrTokenIntrospectionUnavailable = errors.New("gitlab: token introspection unavailable")

// TokenInfo returns the scopes and expiry of the token the portal authenticates
// with, without which "the token works" only means "it worked for /version".
func (c *Client) TokenInfo(ctx context.Context) (*TokenInfo, error) {
	var t TokenInfo
	err := c.do(ctx, http.MethodGet, "/personal_access_tokens/self", nil, nil, &t)
	if errors.Is(err, models.ErrNotFound) || errors.Is(err, ErrForbidden) {
		return nil, ErrTokenIntrospectionUnavailable
	}
	var ae *apiError
	if errors.As(err, &ae) && ae.status == http.StatusUnauthorized {
		return nil, ErrTokenIntrospectionUnavailable
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// GitLab access levels, as the members API reports them. Only the two the
// portal's own operations need are named.
const (
	AccessMaintainer = 40
	AccessOwner      = 50
)

// GroupAccessLevel returns the access level a user has in a group, counting
// inherited membership. models.ErrNotFound means the user is not a member at
// all, which for the portal's token is the same story as "too low" but a
// different sentence.
func (c *Client) GroupAccessLevel(ctx context.Context, groupPath string, userID int) (int, error) {
	var m struct {
		AccessLevel int `json:"access_level"`
	}
	endpoint := fmt.Sprintf("/groups/%s/members/all/%d", projectPath(groupPath), userID)
	if err := c.do(ctx, http.MethodGet, endpoint, nil, nil, &m); err != nil {
		return 0, err
	}
	return m.AccessLevel, nil
}

// HookInfo is a registered webhook as GitLab reports it back. The secret token
// is never returned by the API, so whether the two sides agree on it cannot be
// read - only tested (see TestHook) or inferred from rejected deliveries.
type HookInfo struct {
	ID                  int    `json:"id"`
	URL                 string `json:"url"`
	MergeRequestsEvents bool   `json:"merge_requests_events"`
	// AlertStatus is "executable", "disabled" or "temporarily_disabled": GitLab
	// switches a hook off by itself after enough failed deliveries, and a hook
	// disabled that way looks exactly like a working one until you look here.
	AlertStatus string `json:"alert_status"`
}

// ListGroupHooks lists the hooks on a group.
func (c *Client) ListGroupHooks(ctx context.Context, groupPath string) ([]HookInfo, error) {
	var out []HookInfo
	err := c.do(ctx, http.MethodGet, "/groups/"+projectPath(groupPath)+"/hooks", nil, nil, &out)
	return out, asScopeUnavailable(err)
}

// ListSystemHooks lists the instance-wide hooks (administrator only).
func (c *Client) ListSystemHooks(ctx context.Context) ([]HookInfo, error) {
	var out []HookInfo
	err := c.do(ctx, http.MethodGet, "/hooks", nil, nil, &out)
	return out, asScopeUnavailable(err)
}

// ListProjectHooks lists the hooks on one repository.
func (c *Client) ListProjectHooks(ctx context.Context, projectID int) ([]HookInfo, error) {
	var out []HookInfo
	err := c.do(ctx, http.MethodGet, fmt.Sprintf("/projects/%d/hooks", projectID), nil, nil, &out)
	return out, err
}

// TestHook asks GitLab to deliver a sample merge-request event to a hook, so the
// portal can find out whether the delivery arrives and whether the two sides
// agree on the secret. GitLab builds the payload from a real merge request in
// the project, so a repository that has never had one answers with an error
// rather than a delivery.
//
// scope selects the endpoint: project hooks take a project id, group and system
// hooks do not (pass 0). Only ever called from the admin's own button.
func (c *Client) TestHook(ctx context.Context, scope HookScope, projectID, hookID int) error {
	var endpoint string
	switch scope {
	case HookScopeProject:
		endpoint = fmt.Sprintf("/projects/%d/hooks/%d/test/merge_requests_events", projectID, hookID)
	case HookScopeGroup:
		endpoint = fmt.Sprintf("/groups/%s/hooks/%d/test/merge_requests_events", projectPath(c.gitopsGroup), hookID)
	case HookScopeSystem:
		endpoint = fmt.Sprintf("/hooks/%d", hookID)
	default:
		return fmt.Errorf("gitlab: cannot test a %q hook", scope)
	}
	return c.do(ctx, http.MethodPost, endpoint, nil, nil, nil)
}
