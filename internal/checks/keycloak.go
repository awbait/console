package checks

import (
	"context"
	"strconv"
	"time"

	"console/internal/auth"
	"console/internal/config"
	"console/pkg/models"
)

// Check ids of the Keycloak set, mirrored in web/src/app/configChecks.ts.
const IDKeycloakGroups = "keycloak_groups_claim"

// Reasons the Keycloak check returns.
const (
	reasonNoSignIn    = "no_sign_in"    // nobody has signed in since the portal started
	reasonNoGroups    = "no_groups"     // the token carried no groups at all
	reasonNoTeams     = "no_teams"      // it carried groups, and none of them mean anything here
	reasonRolesUnused = "roles_unmapped" // no group grants a privileged role, so nobody can get one
)

// SignInSource reports what the last successful sign-in carried.
// *auth.SignIns implements it.
type SignInSource interface {
	Last() auth.SignIn
}

// KeycloakChecks builds the Keycloak set.
//
// There is one check and it is passive. Whether the realm really puts the group
// claim into the tokens it issues is not something Keycloak will say: the
// discovery document does not describe claims, and the portal has no way to mint
// a token to look inside. The only evidence is a token that has been issued, so
// the check reads the last one instead of asking.
//
// The failure it is looking for is the quietest one the portal has. With no
// groups claim, RBAC finds no teams and no role, everyone who signs in becomes
// an auditor, the portal opens and looks entirely normal, and the only symptom
// is people saying they cannot see their own services.
func KeycloakChecks(cfg *config.Config, signIns SignInSource) []Check {
	return []Check{{
		ID:        IDKeycloakGroups,
		Component: ComponentKeycloak,
		Vars:      []string{"OIDC_SCOPES", "RBAC_TEAM_GROUP_PREFIX", "RBAC_ADMIN_GROUPS"},
		Run:       func(context.Context) Result { return keycloakGroups(cfg, signIns) },
	}}
}

func keycloakGroups(cfg *config.Config, signIns SignInSource) Result {
	if len(cfg.AdminGroups) == 0 {
		// Nobody can be an administrator, which is a configuration nobody means:
		// the platform sections, the approval queue and this page itself become
		// unreachable the moment the current session ends.
		return verdict(VerdictWarn, reasonRolesUnused, nil)
	}
	if signIns == nil {
		return verdict(VerdictUnknown, ReasonUnavailable, nil)
	}
	last := signIns.Last()
	if last.At.IsZero() {
		return verdict(VerdictUnknown, reasonNoSignIn, nil)
	}
	f := factsOf(
		"last_sign_in", last.At.UTC().Format(time.RFC3339),
		"groups", strconv.Itoa(last.Groups),
		"teams", strconv.Itoa(last.Teams),
		"role", last.Role,
	)
	switch {
	case last.Groups == 0:
		return verdict(VerdictFail, reasonNoGroups, f)
	case last.Teams == 0 && last.Role == string(models.RoleAuditor):
		// Groups arrived and matched nothing: the prefix or the expression is
		// aimed at a group structure this realm does not have.
		return verdict(VerdictWarn, reasonNoTeams, f)
	}
	return ok(f)
}
