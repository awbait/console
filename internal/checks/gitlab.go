package checks

import (
	"context"
	"errors"
	"slices"
	"strconv"
	"strings"
	"time"

	"console/internal/config"
	"console/internal/gitlab"
	"console/pkg/models"
)

// Check ids of the GitLab set, mirrored in web/src/app/configChecks.ts.
const (
	IDGitLabToken       = "gitlab_token"
	IDGitLabGroup       = "gitlab_gitops_group"
	IDGitLabGroupAccess = "gitlab_group_access"
	IDGitLabHook        = "gitlab_webhook"
	IDGitLabDelivery    = "gitlab_webhook_delivery"
)

// Reasons the GitLab checks return.
const (
	reasonMissingScope   = "missing_scope"    // the token cannot use the API the portal needs
	reasonExpired        = "expired"          // the token's day has passed
	reasonExpiresSoon    = "expires_soon"     // it will, and soon enough to plan for
	reasonRevoked        = "revoked"          // somebody withdrew the token
	reasonNoIntrospect   = "no_introspection" // this GitLab will not describe the token to us
	reasonGroupMissing   = "group_missing"    // the GitOps group is not there under that path
	reasonNeedsOwner     = "needs_owner"      // creating team subgroups takes Owner
	reasonNeedsMaint     = "needs_maintainer" // creating repositories and merge requests takes Maintainer
	reasonNotMember      = "not_member"       // the token's account is not in the group at all
	reasonNotRegistered  = "not_registered"   // no scope worked, so no hook was registered
	reasonHookMissing    = "hook_missing"     // the scope resolved, but the hook is not in GitLab
	reasonHookDisabled   = "hook_disabled"    // GitLab switched the hook off after failed deliveries
	reasonHookNotMR      = "hook_not_mr"      // the hook is registered but not on merge-request events
	reasonPartialHooks   = "partial_coverage" // per-repository scope, and some repositories have none
	reasonSecretMismatch = "secret_mismatch"  // every delivery is being rejected on its secret
	reasonSomeRejected   = "some_rejected"    // some are
	reasonNoDeliveries   = "no_deliveries"    // nothing has arrived since the portal started
)

// expiryWarning is how far ahead a token expiry is worth a warning. A month is
// long enough to get a new token issued through whatever process issues them,
// and short enough that the warning still means something when it appears.
const expiryWarning = 30 * 24 * time.Hour

// hookSweepLimit bounds the per-repository coverage sweep. Under the project
// scope the check makes one call per repository, and a GitOps group grows
// without bound; past this many the check reports what it saw and says it did
// not look at the rest, which is more honest than a page that takes a minute to
// refresh.
const hookSweepLimit = 200

// GitLabAPI is the slice of the GitLab client the checks read through. Only
// reads, except TestHook, which is called from the admin's button and never from
// a scheduled round.
type GitLabAPI interface {
	CurrentUser(ctx context.Context) (*gitlab.Account, error)
	TokenInfo(ctx context.Context) (*gitlab.TokenInfo, error)
	GetGroup(ctx context.Context, fullPath string) (*gitlab.Group, error)
	GroupAccessLevel(ctx context.Context, groupPath string, userID int) (int, error)
	ListGroupHooks(ctx context.Context, groupPath string) ([]gitlab.HookInfo, error)
	ListSystemHooks(ctx context.Context) ([]gitlab.HookInfo, error)
	ListProjectHooks(ctx context.Context, projectID int) ([]gitlab.HookInfo, error)
	ListGroupProjects(ctx context.Context) ([]gitlab.Project, error)
	TestHook(ctx context.Context, scope gitlab.HookScope, projectID, hookID int) error
}

// HookScoper reports the webhook scope that was actually resolved at startup.
// *gitlab.HookManager implements it, including on a nil receiver ("none").
type HookScoper interface {
	Scope() gitlab.HookScope
}

// Deliveries reports what has arrived from a webhook source since the portal
// started. *webhooks.Deliveries implements it.
type Deliveries interface {
	Get(source string) DeliveryCounts
	Since() time.Time
}

// DeliveryCounts is what one source has delivered. It mirrors
// webhooks.SourceDeliveries; the adapter lives in cmd/portal so this package
// does not depend on the HTTP layer.
type DeliveryCounts struct {
	Accepted     int
	Rejected     int
	BadRequest   int
	LastAccepted time.Time
	LastRejected time.Time
	Total        int
}

// GitLabChecks builds the GitLab set. api may be nil in tests, in which case the
// checks that need it report unknown rather than panicking.
func GitLabChecks(cfg *config.Config, api GitLabAPI, hooks HookScoper, deliveries Deliveries) []Check {
	return []Check{
		{
			ID:        IDGitLabToken,
			Component: ComponentGitLab,
			Vars:      []string{"GITLAB_TOKEN"},
			Run:       func(ctx context.Context) Result { return gitlabToken(ctx, api) },
		},
		{
			ID:        IDGitLabGroup,
			Component: ComponentGitLab,
			Vars:      []string{"GITLAB_GITOPS_GROUP"},
			Run:       func(ctx context.Context) Result { return gitlabGroup(ctx, api, cfg.GitLabGitopsGroup) },
		},
		{
			ID:        IDGitLabGroupAccess,
			Component: ComponentGitLab,
			Vars:      []string{"GITLAB_GITOPS_GROUP", "GITLAB_CREATE_TEAM_SUBGROUP"},
			Run: func(ctx context.Context) Result {
				return gitlabGroupAccess(ctx, api, cfg.GitLabGitopsGroup, cfg.GitLabCreateGroup)
			},
		},
		{
			ID:        IDGitLabHook,
			Component: ComponentGitLab,
			Vars:      []string{"GITLAB_WEBHOOK_URL", "GITLAB_WEBHOOK_SCOPE"},
			Run:       func(ctx context.Context) Result { return gitlabHook(ctx, cfg, api, hooks) },
		},
		{
			ID:        IDGitLabDelivery,
			Component: ComponentGitLab,
			Vars:      []string{"GITLAB_WEBHOOK_TOKEN"},
			Run: func(context.Context) Result {
				return deliveryCheck(deliveries, "gitlab", cfg.GitLabWebhookToken != "")
			},
		},
	}
}

// gitlabToken answers what "GitLab is up" never does: who the portal is over
// there, what that token may do, and how long it will keep doing it. A token
// without the api scope passes every health probe and fails the first order.
func gitlabToken(ctx context.Context, api GitLabAPI) Result {
	if api == nil {
		return verdict(VerdictUnknown, ReasonUnavailable, nil)
	}
	me, err := api.CurrentUser(ctx)
	if err != nil {
		return verdict(VerdictUnknown, ReasonUnavailable, nil)
	}
	f := factsOf("user", me.Username, "admin", strconv.FormatBool(me.IsAdmin))
	info, err := api.TokenInfo(ctx)
	if errors.Is(err, gitlab.ErrTokenIntrospectionUnavailable) {
		// A group or project access token, or an older instance. The token
		// evidently works - it just answered as a user - but its scopes and
		// expiry are not ours to read.
		return verdict(VerdictUnknown, reasonNoIntrospect, f)
	}
	if err != nil {
		return verdict(VerdictUnknown, ReasonUnavailable, f)
	}
	f["scopes"] = strings.Join(info.Scopes, ", ")
	if info.ExpiresAt != "" {
		f["expires_at"] = info.ExpiresAt
	}
	if info.Revoked || (!info.Active && info.Name != "") {
		return verdict(VerdictFail, reasonRevoked, f)
	}
	if !slices.Contains(info.Scopes, "api") {
		return verdict(VerdictFail, reasonMissingScope, f)
	}
	left, known := daysUntil(info.ExpiresAt)
	switch {
	case known && left < 0:
		return verdict(VerdictFail, reasonExpired, f)
	case known && time.Duration(left)*24*time.Hour <= expiryWarning:
		f["days_left"] = strconv.Itoa(left)
		return verdict(VerdictWarn, reasonExpiresSoon, f)
	}
	return ok(f)
}

// gitlabGroup checks that the group every GitOps repository lives under is there
// and visible to the token.
func gitlabGroup(ctx context.Context, api GitLabAPI, path string) Result {
	if api == nil {
		return verdict(VerdictUnknown, ReasonUnavailable, nil)
	}
	f := factsOf("group", path)
	g, err := api.GetGroup(ctx, path)
	switch {
	case errors.Is(err, models.ErrNotFound):
		return verdict(VerdictFail, reasonGroupMissing, f)
	case errors.Is(err, gitlab.ErrForbidden):
		return verdict(VerdictFail, ReasonForbidden, f)
	case err != nil:
		return verdict(VerdictUnknown, ReasonUnavailable, f)
	}
	f["group_id"] = strconv.Itoa(g.ID)
	return ok(f)
}

// gitlabGroupAccess checks the role the token holds in that group. Maintainer is
// the floor for creating repositories and opening merge requests; Owner is
// needed on top of that to create a team's subgroup, which is what the portal
// does on a team's first order when GITLAB_CREATE_TEAM_SUBGROUP is on.
func gitlabGroupAccess(ctx context.Context, api GitLabAPI, path string, createSubgroups bool) Result {
	if api == nil {
		return verdict(VerdictUnknown, ReasonUnavailable, nil)
	}
	need := gitlab.AccessMaintainer
	reason := reasonNeedsMaint
	if createSubgroups {
		need, reason = gitlab.AccessOwner, reasonNeedsOwner
	}
	f := factsOf("group", path, "required", accessName(need))
	me, err := api.CurrentUser(ctx)
	if err != nil {
		return verdict(VerdictUnknown, ReasonUnavailable, f)
	}
	if me.IsAdmin {
		// An instance administrator is above group membership and is usually not
		// a member at all, so asking the members API about them proves nothing.
		f["access"] = "admin"
		return ok(f)
	}
	level, err := api.GroupAccessLevel(ctx, path, me.ID)
	switch {
	case errors.Is(err, models.ErrNotFound):
		return verdict(VerdictFail, reasonNotMember, f)
	case err != nil:
		return verdict(VerdictUnknown, ReasonUnavailable, f)
	}
	f["access"] = accessName(level)
	if level < need {
		return verdict(VerdictFail, reason, f)
	}
	return ok(f)
}

// gitlabHook checks that the merge-request webhook the portal registered for
// itself is really in GitLab, on merge-request events, and not switched off. The
// resolved scope comes from the hook manager, which is the only place that knows
// which of the three worked - until now it was said once in a startup log line.
func gitlabHook(ctx context.Context, cfg *config.Config, api GitLabAPI, hooks HookScoper) Result {
	if cfg.GitLabWebhookURL == "" || cfg.GitLabWebhookToken == "" {
		return verdict(VerdictSkip, ReasonNotConfigured, nil)
	}
	if api == nil || hooks == nil {
		return verdict(VerdictUnknown, ReasonUnavailable, nil)
	}
	scope := hooks.Scope()
	f := factsOf("scope", string(scope), "requested_scope", cfg.GitLabWebhookScope, "hook_url", cfg.GitLabWebhookURL)
	if scope == gitlab.HookScopeNone || scope == "" {
		return verdict(VerdictFail, reasonNotRegistered, f)
	}
	if scope == gitlab.HookScopeProject {
		return gitlabProjectHooks(ctx, api, cfg.GitLabWebhookURL, f)
	}
	var (
		list []gitlab.HookInfo
		err  error
	)
	if scope == gitlab.HookScopeGroup {
		list, err = api.ListGroupHooks(ctx, cfg.GitLabGitopsGroup)
	} else {
		list, err = api.ListSystemHooks(ctx)
	}
	if err != nil {
		return verdict(VerdictUnknown, ReasonUnavailable, f)
	}
	hook := findHook(list, cfg.GitLabWebhookURL)
	if hook == nil {
		return verdict(VerdictFail, reasonHookMissing, f)
	}
	f["hook_id"] = strconv.Itoa(hook.ID)
	if !hook.MergeRequestsEvents {
		return verdict(VerdictFail, reasonHookNotMR, f)
	}
	if disabled(*hook) {
		f["alert_status"] = hook.AlertStatus
		return verdict(VerdictFail, reasonHookDisabled, f)
	}
	return ok(f)
}

// gitlabProjectHooks counts how many repositories of the GitOps group carry the
// hook. Under the per-repository scope a repository created outside the portal -
// or created while the portal was down - has none, and merges in it are noticed
// only by the poll.
func gitlabProjectHooks(ctx context.Context, api GitLabAPI, hookURL string, f map[string]string) Result {
	projects, err := api.ListGroupProjects(ctx)
	if err != nil {
		return verdict(VerdictUnknown, ReasonUnavailable, f)
	}
	f["repositories"] = strconv.Itoa(len(projects))
	if len(projects) == 0 {
		// Nothing to cover yet: the portal hooks each repository as it creates it.
		return ok(f)
	}
	looked := projects
	if len(looked) > hookSweepLimit {
		looked = looked[:hookSweepLimit]
		f["examined"] = strconv.Itoa(hookSweepLimit)
	}
	covered, off := 0, 0
	for _, p := range looked {
		list, herr := api.ListProjectHooks(ctx, p.ID)
		if herr != nil {
			return verdict(VerdictUnknown, ReasonUnavailable, f)
		}
		hook := findHook(list, hookURL)
		switch {
		case hook == nil:
		case disabled(*hook):
			off++
		default:
			covered++
		}
	}
	f["covered"] = strconv.Itoa(covered)
	f["uncovered"] = strconv.Itoa(len(looked) - covered)
	if off > 0 {
		f["disabled"] = strconv.Itoa(off)
		return verdict(VerdictFail, reasonHookDisabled, f)
	}
	if covered < len(looked) {
		return verdict(VerdictWarn, reasonPartialHooks, f)
	}
	return ok(f)
}

// deliveryCheck turns the delivery counters into a verdict. It is the only check
// that can see whether the two sides agree on a secret: GitLab and Harbor never
// hand theirs back, but a delivery rejected on it is counted, and a source that
// only ever gets rejected is a secret that has drifted apart.
func deliveryCheck(d Deliveries, source string, configured bool) Result {
	if !configured {
		return verdict(VerdictSkip, ReasonNotConfigured, nil)
	}
	if d == nil {
		return verdict(VerdictUnknown, ReasonUnavailable, nil)
	}
	c := d.Get(source)
	f := factsOf("since", d.Since().UTC().Format(time.RFC3339))
	if c.Accepted > 0 {
		f["accepted"] = strconv.Itoa(c.Accepted)
		f["last_accepted"] = c.LastAccepted.UTC().Format(time.RFC3339)
	}
	if c.Rejected > 0 {
		f["rejected"] = strconv.Itoa(c.Rejected)
		f["last_rejected"] = c.LastRejected.UTC().Format(time.RFC3339)
	}
	switch {
	case c.Rejected > 0 && c.Accepted == 0:
		return verdict(VerdictFail, reasonSecretMismatch, f)
	case c.Rejected > 0:
		return verdict(VerdictWarn, reasonSomeRejected, f)
	case c.Total == 0:
		// Nothing has arrived, and that is what a quiet day looks like too. The
		// page offers the button that settles it instead of guessing.
		return verdict(VerdictUnknown, reasonNoDeliveries, f)
	}
	return ok(f)
}

// findHook returns the hook registered for this URL, or nil.
func findHook(list []gitlab.HookInfo, url string) *gitlab.HookInfo {
	for i := range list {
		if list[i].URL == url {
			return &list[i]
		}
	}
	return nil
}

// disabled reports a hook GitLab has switched off after failed deliveries. An
// empty status is an older GitLab that does not report one, which counts as
// working - the deliveries check would catch it either way.
func disabled(h gitlab.HookInfo) bool {
	return h.AlertStatus == "disabled" || h.AlertStatus == "temporarily_disabled"
}

// accessName maps a GitLab access level onto the name its UI uses. An
// unrecognised level is reported as its number rather than guessed at.
func accessName(level int) string {
	switch level {
	case 0:
		return "none"
	case 5:
		return "minimal"
	case 10:
		return "guest"
	case 20:
		return "reporter"
	case 30:
		return "developer"
	case gitlab.AccessMaintainer:
		return "maintainer"
	case gitlab.AccessOwner:
		return "owner"
	default:
		return strconv.Itoa(level)
	}
}

// daysUntil returns whole days from today to a GitLab date ("2006-01-02"),
// negative once it has passed. known is false for a token that never expires or
// a date that does not parse.
func daysUntil(date string) (days int, known bool) {
	if date == "" {
		return 0, false
	}
	t, err := time.Parse(time.DateOnly, date)
	if err != nil {
		return 0, false
	}
	return int(time.Until(t).Hours() / 24), true
}
