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
	IDHarborProjects  = "harbor_projects"
	IDHarborArtifacts = "harbor_artifacts"
	IDHarborHook      = "harbor_webhook"
	IDHarborDelivery  = "harbor_webhook_delivery"
)

// Reasons the Harbor checks return.
const (
	reasonProjectsMissing = "projects_missing" // a configured project is not in Harbor
	reasonProjectsHidden  = "projects_hidden"  // it may be, but these credentials cannot see it
	reasonNoRepositories  = "no_repositories"  // the projects are readable and empty
	reasonNoPolicy        = "no_policy"        // Harbor has no webhook aimed at this portal
	reasonPolicyDisabled  = "policy_disabled"  // it has one and it is switched off
	reasonMissingEvent    = "missing_event"    // it is on, but not subscribed to a pushed chart
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
			Vars:      []string{"HARBOR_PROJECTS", "HARBOR_ROBOT_USER"},
			Run:       func(ctx context.Context) Result { return harborProjects(ctx, api, cfg.HarborProjects) },
		},
		{
			ID:        IDHarborArtifacts,
			Component: ComponentHarbor,
			Vars:      []string{"HARBOR_ROBOT_USER", "HARBOR_ROBOT_TOKEN"},
			Run:       func(ctx context.Context) Result { return harborArtifacts(ctx, api, cfg.HarborProjects) },
		},
		{
			ID:        IDHarborHook,
			Component: ComponentHarbor,
			Vars:      []string{"HARBOR_WEBHOOK_SECRET", "PUBLIC_URL"},
			Run:       func(ctx context.Context) Result { return harborHook(ctx, cfg, api) },
		},
		{
			ID:        IDHarborDelivery,
			Component: ComponentHarbor,
			Vars:      []string{"HARBOR_WEBHOOK_SECRET"},
			Run: func(context.Context) Result {
				return deliveryCheck(deliveries, "harbor", cfg.HarborWebhookKey != "")
			},
		},
	}
}

// harborProjects checks every project the catalog is built from. The catalog
// skips a project it cannot read rather than failing (internal/harbor.ListCharts
// does that on purpose, so one bad project does not empty the shelf), which is
// exactly why a project that quietly disappeared is invisible everywhere else.
func harborProjects(ctx context.Context, api HarborAPI, projects []string) Result {
	if api == nil {
		return verdict(VerdictUnknown, ReasonUnavailable, nil)
	}
	if len(projects) == 0 {
		return verdict(VerdictFail, ReasonNotConfigured, nil)
	}
	f := factsOf("projects", strings.Join(projects, ", "))
	var missing, hidden []string
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
	case repos == 0:
		return verdict(VerdictWarn, reasonNoRepositories, f)
	}
	return ok(f)
}

// harborArtifacts reads a repository's artifacts the way the catalog does. Harbor
// grants "list repositories" and "read artifacts" separately, so a robot that
// passes the check above can still produce a catalog where every chart has no
// versions. Doing the real read answers that; asking Harbor to describe the
// account's permissions does not, because a robot is not a user and the
// permissions endpoint refuses it.
func harborArtifacts(ctx context.Context, api HarborAPI, projects []string) Result {
	if api == nil {
		return verdict(VerdictUnknown, ReasonUnavailable, nil)
	}
	for _, p := range projects {
		list, err := api.ListRepositories(ctx, p)
		if err != nil || len(list) == 0 {
			continue // already judged by harborProjects
		}
		repo := list[0]
		f := factsOf("repository", repo.Project+"/"+repo.Name)
		n, err := api.CountArtifacts(ctx, repo.Project, repo.Name)
		switch {
		case err != nil && harbor.IsAccessDenied(err):
			return verdict(VerdictFail, ReasonForbidden, f)
		case err != nil:
			return verdict(VerdictUnknown, ReasonUnavailable, f)
		}
		f["artifacts"] = strconv.Itoa(n)
		if n == 0 {
			return verdict(VerdictWarn, reasonNoRepositories, f)
		}
		return ok(f)
	}
	return verdict(VerdictSkip, reasonNoRepositories, nil)
}

// harborHook looks for a webhook policy in Harbor that delivers to this portal.
// This is the half of the Harbor webhook the portal cannot otherwise see: it
// knows its own secret is set and assumes the other side exists, and until a
// chart is pushed nothing contradicts that.
func harborHook(ctx context.Context, cfg *config.Config, api HarborAPI) Result {
	if cfg.HarborWebhookKey == "" {
		return verdict(VerdictSkip, ReasonNotConfigured, nil)
	}
	if api == nil {
		return verdict(VerdictUnknown, ReasonUnavailable, nil)
	}
	want := strings.TrimRight(cfg.PublicURL, "/") + HarborWebhookPath
	f := factsOf("expected_url", want)
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
		return ok(f)
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
