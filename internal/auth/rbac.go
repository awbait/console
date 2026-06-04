// Package auth handles Keycloak OIDC, server-side sessions, and RBAC.
package auth

import (
	"regexp"
	"strings"

	"idp/pkg/models"
)

// RBAC maps Keycloak groups to portal teams and roles. It is deliberately
// tolerant of external IdPs whose group claim may be a nested full path
// (e.g. "/group/group/team-core/group") or use a non-default naming scheme.
type RBAC struct {
	AdminGroups []string
	// TeamPrefix matches against EACH path segment of a group (not just the last),
	// so a prefixed segment anywhere in a nested path resolves
	// ("/group/group/team-core/group" -> team "core"). Empty disables prefix
	// matching.
	TeamPrefix string
	// TeamRegex, when set, overrides TeamPrefix: it is matched against the raw
	// group string and its first capture group is taken as the team name. This
	// covers arbitrary structures (e.g. "^/teams/(.+)$" or "(?:^|/)team-([^/]+)").
	TeamRegex *regexp.Regexp
}

func normalizeGroup(g string) string { return strings.TrimPrefix(g, "/") }

// segments splits a group path into its non-empty segments ("/a/b/c" -> [a b c]).
func segments(g string) []string {
	g = strings.Trim(g, "/")
	if g == "" {
		return nil
	}
	return strings.Split(g, "/")
}

// teamFor derives the team name a group maps to, or "" if it isn't a team group.
func (r RBAC) teamFor(group string) string {
	if r.TeamRegex != nil {
		if m := r.TeamRegex.FindStringSubmatch(group); len(m) > 1 {
			return strings.TrimSpace(m[1])
		}
		return ""
	}
	if r.TeamPrefix != "" {
		// A prefixed segment may sit anywhere in the path, so scan all segments.
		for _, seg := range segments(group) {
			if team, ok := strings.CutPrefix(seg, r.TeamPrefix); ok && team != "" {
				return team
			}
		}
	}
	return ""
}

// BuildUser derives the portal user (teams + role) from OIDC claims.
func (r RBAC) BuildUser(sub, email, username, name string, groups []string) *models.User {
	u := &models.User{Subject: sub, Email: email, Username: username, Name: name, Role: models.RoleViewer}

	// Admin groups are matched against the full (slash-stripped) path and against
	// every path segment, so an admin group configured as "platform-admins" matches
	// a token group at any depth (e.g. "/org/platform-admins/sub").
	adminSet := map[string]struct{}{}
	for _, ag := range r.AdminGroups {
		adminSet[normalizeGroup(ag)] = struct{}{}
	}
	admin := false
	seen := map[string]struct{}{}
	for _, g := range groups {
		if _, ok := adminSet[normalizeGroup(g)]; ok {
			admin = true
		}
		for _, seg := range segments(g) {
			if _, ok := adminSet[seg]; ok {
				admin = true
				break
			}
		}
		if team := r.teamFor(g); team != "" {
			if _, dup := seen[team]; !dup {
				seen[team] = struct{}{}
				u.Teams = append(u.Teams, team)
			}
		}
	}

	switch {
	case admin:
		u.Role = models.RoleAdmin
	case len(u.Teams) > 0:
		u.Role = models.RoleMember
	default:
		u.Role = models.RoleViewer
	}
	return u
}
