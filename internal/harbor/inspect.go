package harbor

import (
	"context"
	"net/url"
	"slices"
	"strings"
)

// Read-only calls the configuration checks use (internal/checks). They answer
// what a healthz cannot: whether the robot account can actually read the
// projects the catalog is built from, and whether Harbor has a webhook policy
// pointing back at this portal. Nothing here writes to Harbor.

// RepoRef is one repository of a project, as the checks need it: the short name
// the catalog addresses it by.
type RepoRef struct {
	Project string
	Name    string
}

// ListRepositories lists the repositories of one project. models.ErrNotFound
// means Harbor has no such project; a 401/403 (see IsAccessDenied) means it may
// exist but these credentials cannot see it, which for the catalog is the same
// empty shelf and a different fix.
func (c *Client) ListRepositories(ctx context.Context, project string) ([]RepoRef, error) {
	var repos []apiRepo
	err := c.apiGet(ctx, "/projects/"+url.PathEscape(project)+"/repositories",
		url.Values{"page_size": {"100"}}, &repos)
	if err != nil {
		return nil, err
	}
	out := make([]RepoRef, 0, len(repos))
	for _, r := range repos {
		out = append(out, RepoRef{Project: project, Name: repoShortName(project, r.Name)})
	}
	return out, nil
}

// CountArtifacts returns how many artifacts a repository holds. The catalog
// cannot show a single chart version without this call succeeding, so it is the
// honest test of "the robot may read artifacts here" - stronger than asking
// Harbor to describe the account's permissions, and it works for a robot
// account, which the permissions endpoint does not.
func (c *Client) CountArtifacts(ctx context.Context, project, repo string) (int, error) {
	arts, err := c.listArtifacts(ctx, project, repo)
	if err != nil {
		return 0, err
	}
	return len(arts), nil
}

// WebhookPolicy is one of a project's webhook policies, trimmed to what tells us
// whether it points at this portal. The auth header value is masked by Harbor
// itself, so a policy can be matched by address and events but never by secret.
type WebhookPolicy struct {
	Name       string   `json:"name"`
	Enabled    bool     `json:"enabled"`
	EventTypes []string `json:"event_types"`
	Targets    []struct {
		Address string `json:"address"`
		Type    string `json:"type"`
	} `json:"targets"`
}

// TargetsURL reports whether the policy delivers to this address, ignoring a
// trailing slash.
func (p WebhookPolicy) TargetsURL(address string) bool {
	want := strings.TrimRight(address, "/")
	for _, t := range p.Targets {
		if strings.TrimRight(t.Address, "/") == want {
			return true
		}
	}
	return false
}

// HasEvent reports whether the policy is subscribed to an event type.
func (p WebhookPolicy) HasEvent(event string) bool {
	return slices.Contains(p.EventTypes, event)
}

// ListWebhookPolicies returns the webhook policies configured on a project.
// Reading them needs project-admin rights, so a robot with read-only access gets
// a 403 here: that is "we cannot look", not "there is no webhook".
func (c *Client) ListWebhookPolicies(ctx context.Context, project string) ([]WebhookPolicy, error) {
	var out []WebhookPolicy
	err := c.apiGet(ctx, "/projects/"+url.PathEscape(project)+"/webhook/policies",
		url.Values{"page_size": {"100"}}, &out)
	if err != nil {
		return nil, err
	}
	return out, nil
}
