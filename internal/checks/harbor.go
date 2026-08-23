package checks

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"console/internal/config"
	"console/internal/harbor"
	"console/pkg/models"
)

// Check ids of the Harbor set, mirrored in web/src/app/configChecks.ts.
const (
	IDHarborProjects = "harbor_projects"
	IDHarborHook     = "harbor_webhook"
)

// Reasons the Harbor checks return.
const (
	reasonProjectsMissing = "projects_missing" // a configured project is not in Harbor
	reasonProjectsHidden  = "projects_hidden"  // it may be, but these credentials cannot see it
	reasonNoRepositories  = "no_repositories"  // the projects are readable and empty
	reasonNoArtifacts     = "no_artifacts"     // repositories are readable and their contents are not
	reasonNoPolicy        = "no_policy"        // Harbor has no webhook aimed at this portal
	reasonPolicyDisabled  = "policy_disabled"  // it has one and it is switched off
	reasonMissingEvent    = "missing_event"    // it is on, but not subscribed to a pushed chart

	// Reasons a check passed, so the green says what was confirmed.
	reasonChartsReadable = "charts_readable" // every project is visible and its charts read
	reasonPolicyFound    = "policy_found"    // Harbor has an enabled policy aimed at this portal
)

// pushArtifactEvent is the Harbor event a new chart version arrives as. It is
// the only one the portal acts on (see internal/webhooks.Handler.Harbor), so it
// is the only one a policy has to carry.
const pushArtifactEvent = "PUSH_ARTIFACT"

// HarborAPI is the slice of the Harbor client the checks read through.
type HarborAPI interface {
	ListRepositories(ctx context.Context, project string) ([]harbor.RepoRef, error)
	CountArtifacts(ctx context.Context, project, repo string) (int, error)
	ListWebhookPolicies(ctx context.Context, project string) ([]harbor.WebhookPolicy, error)
}

// HarborChecks builds the Harbor set.
func HarborChecks(cfg *config.Config, api HarborAPI, deliveries Deliveries) []Check {
	return []Check{
		{
			ID:        IDHarborProjects,
			Component: ComponentHarbor,
			Vars:      []string{"HARBOR_PROJECTS", "HARBOR_ROBOT_USER", "HARBOR_ROBOT_TOKEN"},
			Run:       func(ctx context.Context) Result { return harborProjects(ctx, api, cfg.HarborProjects) },
		},
		{
			ID:        IDHarborHook,
			Component: ComponentHarbor,
			Vars:      []string{"HARBOR_WEBHOOK_SECRET", "PUBLIC_URL"},
			Run:       func(ctx context.Context) Result { return harborWebhook(ctx, cfg, api, deliveries) },
		},
	}
}

// harborProjects checks that the catalog can be built at all: every configured
// project is there, visible to the robot, and its charts are readable.
//
// Listing repositories and reading their artifacts are separate permissions in
// Harbor, so a robot that passes the first can still produce a catalog where
// every chart has no versions. The check therefore does the read the catalog
// does rather than asking Harbor to describe the account's permissions, which
// also happens to be the only way that works for a robot: a robot is not a user,
// and the permissions endpoint refuses it.
//
// The catalog itself skips a project it cannot read (internal/harbor.ListCharts
// does that on purpose, so one bad project does not empty the shelf), which is
// exactly why a project that quietly disappeared is invisible everywhere else.
func harborProjects(ctx context.Context, api HarborAPI, projects []string) Result {
	if api == nil {
		return verdict(VerdictUnknown, ReasonUnavailable, nil)
	}
	if len(projects) == 0 {
		return verdict(VerdictFail, ReasonNotConfigured, nil)
	}
	f := map[string]string{}
	var missing, hidden []string
	var sample *harbor.RepoRef
	repos := 0
	for _, p := range projects {
		list, err := api.ListRepositories(ctx, p)
		switch {
		case errors.Is(err, models.ErrNotFound):
			missing = append(missing, p)
		case err != nil && harbor.IsAccessDenied(err):
			hidden = append(hidden, p)
		case err != nil:
			return verdict(VerdictUnknown, ReasonUnavailable, f)
		default:
			repos += len(list)
			if sample == nil && len(list) > 0 {
				sample = &list[0]
			}
		}
	}
	f["repositories"] = strconv.Itoa(repos)
	switch {
	case len(missing) > 0:
		f["missing"] = strings.Join(missing, ", ")
		return verdict(VerdictFail, reasonProjectsMissing, f)
	case len(hidden) > 0:
		f["hidden"] = strings.Join(hidden, ", ")
		return verdict(VerdictFail, reasonProjectsHidden, f)
	case sample == nil:
		// The projects read and hold nothing. Worth saying at setup time, when
		// an empty catalog is the question being asked.
		return verdict(VerdictWarn, reasonNoRepositories, f)
	}

	// Which repository was sampled is not reported when it works: it is whichever
	// one came back first, and to a reader it is an arbitrary name raising a
	// question the answer does not need. It is named where reading it failed,
	// because then it is the place to go and look at the robot's permissions.
	_, err := api.CountArtifacts(ctx, sample.Project, sample.Name)
	switch {
	case err != nil && harbor.IsAccessDenied(err):
		f["repository"] = sample.Project + "/" + sample.Name
		return verdict(VerdictFail, reasonNoArtifacts, f)
	case err != nil:
		return verdict(VerdictUnknown, ReasonUnavailable, f)
	}
	return verdict(VerdictOK, reasonChartsReadable, f)
}

// harborWebhook is the whole Harbor notification path in one verdict: the
// portal's secret, Harbor's own policy pointing back here, and whether anything
// has actually arrived.
//
// Evidence outranks inference, as with GitLab: deliveries that arrive and are
// accepted prove the policy exists and the secrets match, whatever the policy
// list says or refuses to say.
func harborWebhook(ctx context.Context, cfg *config.Config, api HarborAPI, deliveries Deliveries) Result {
	if cfg.HarborWebhookKey == "" {
		// A delay rather than a failure: without it the portal finds new chart
		// versions on the next poll instead of at once.
		return verdict(VerdictSkip, ReasonNotConfigured, nil)
	}
	if api == nil {
		return verdict(VerdictUnknown, ReasonUnavailable, nil)
	}
	want := strings.TrimRight(cfg.PublicURL, "/") + HarborWebhookPath
	f := factsOf("expected_url", want)
	if res, done := deliveryVerdict(deliveries, "harbor", f); done {
		return res
	}

	var withPolicy, disabledIn, withoutEvent, unreadable []string
	for _, p := range cfg.HarborProjects {
		policies, err := api.ListWebhookPolicies(ctx, p)
		if err != nil {
			// Listing policies needs project-admin rights; a read-only robot is
			// refused. That is "we cannot look here", not "there is no webhook".
			unreadable = append(unreadable, p)
			continue
		}
		for _, pol := range policies {
			if !pol.TargetsURL(want) {
				continue
			}
			switch {
			case !pol.Enabled:
				disabledIn = append(disabledIn, p)
			case !pol.HasEvent(pushArtifactEvent):
				withoutEvent = append(withoutEvent, p)
			default:
				withPolicy = append(withPolicy, p)
			}
			break
		}
	}
	if len(unreadable) > 0 {
		f["unreadable"] = strings.Join(unreadable, ", ")
	}
	switch {
	case len(withPolicy) > 0:
		f["projects"] = strings.Join(withPolicy, ", ")
		return verdict(VerdictOK, reasonPolicyFound, f)
	case len(disabledIn) > 0:
		f["projects"] = strings.Join(disabledIn, ", ")
		return verdict(VerdictFail, reasonPolicyDisabled, f)
	case len(withoutEvent) > 0:
		f["projects"] = strings.Join(withoutEvent, ", ")
		f["expected_event"] = pushArtifactEvent
		return verdict(VerdictWarn, reasonMissingEvent, f)
	case len(unreadable) == len(cfg.HarborProjects):
		return verdict(VerdictUnknown, ReasonForbidden, f)
	}
	return verdict(VerdictFail, reasonNoPolicy, f)
}
