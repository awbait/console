package checks

import (
	"bytes"
	"context"
	"net/url"
	"strings"
	"text/template"

	"console/internal/config"
)

// Static checks read the configuration and nothing else: no network, no
// upstream, no clock. They are the ones that catch a deployment where two
// variables disagree with each other - the kind of mistake that stays invisible
// until the first order lands on it.

// Check ids of the static set, mirrored in web/src/app/configChecks.ts.
const (
	IDWebhookPairing     = "webhook_pairing"
	IDWebhookURL         = "webhook_url"
	IDInstanceDirTmpl    = "instance_dir_template"
	IDAppNameTmpl        = "app_name_template"
	IDAutoMerge          = "auto_merge"
	IDHarborWebhookSetup = "harbor_webhook_secret"
)

// Reasons the static checks return.
const (
	reasonURLWithoutToken = "url_without_token" // GitLab is told where to deliver, but with no secret the portal rejects it
	reasonTokenWithoutURL = "token_without_url" // the portal will accept deliveries nobody registered
	reasonSchemeMismatch  = "scheme_mismatch"   // https hook against an http portal, or the other way round
	reasonHostMismatch    = "host_mismatch"     // the hook points at a different host than the portal's own address
	reasonPathMismatch    = "path_mismatch"     // the hook points at something that is not the portal's webhook endpoint
	reasonNotUnique       = "not_unique"        // the template gives two different services the same name
	reasonTeamCollision   = "team_collision"    // the template gives two teams the same application name
	reasonChartCollision  = "chart_collision"   // the template gives two charts the same application name
	reasonBadTemplate     = "bad_template"      // the template does not parse
	reasonEnabled         = "enabled"           // the setting is on, and it should not be outside a stand
	reasonPollingOnly     = "polling_only"      // no secret, so this source is only ever noticed by the poll
)

// GitLabWebhookPath and HarborWebhookPath are where the portal receives each
// source. Kept here so the checks compare against the routes the router really
// registers (internal/api.Server.Router) rather than a sentence in a README.
const (
	GitLabWebhookPath = "/api/v1/webhooks/gitlab"
	HarborWebhookPath = "/api/v1/webhooks/harbor"
)

// Static returns the checks that need only the configuration.
func Static(cfg *config.Config) []Check {
	return []Check{
		{
			ID:        IDWebhookPairing,
			Component: ComponentPortal,
			Vars:      []string{"GITLAB_WEBHOOK_URL", "GITLAB_WEBHOOK_TOKEN", "STATUS_UPDATE_MODE"},
			Run:       func(context.Context) Result { return webhookPairing(cfg) },
		},
		{
			ID:        IDWebhookURL,
			Component: ComponentPortal,
			Vars:      []string{"GITLAB_WEBHOOK_URL", "PUBLIC_URL"},
			Run:       func(context.Context) Result { return webhookURL(cfg) },
		},
		{
			ID:        IDInstanceDirTmpl,
			Component: ComponentPortal,
			Vars:      []string{"GITLAB_INSTANCE_DIR_TEMPLATE"},
			Run:       func(context.Context) Result { return instanceDirTemplate(cfg.GitLabInstanceTmpl) },
		},
		{
			ID:        IDAppNameTmpl,
			Component: ComponentPortal,
			Vars:      []string{"ARGOCD_APP_NAME_TEMPLATE"},
			Run:       func(context.Context) Result { return appNameTemplate(cfg.ArgoCDAppNameTmpl) },
		},
		{
			ID:        IDAutoMerge,
			Component: ComponentPortal,
			Vars:      []string{"GITLAB_AUTO_MERGE"},
			Run:       func(context.Context) Result { return autoMerge(cfg.GitLabAutoMerge) },
		},
		{
			ID:        IDHarborWebhookSetup,
			Component: ComponentPortal,
			Vars:      []string{"HARBOR_WEBHOOK_SECRET", "CATALOG_AUTODISCOVER"},
			Run:       func(context.Context) Result { return harborWebhookSecret(cfg) },
		},
	}
}

// webhookPairing checks the two halves of the GitLab webhook against each other.
// The portal registers its own hook only when both are set (see cmd/portal), and
// it rejects every delivery whose secret does not match, so one half alone is
// always a misconfiguration - just a quiet one.
func webhookPairing(cfg *config.Config) Result {
	url, token := cfg.GitLabWebhookURL != "", cfg.GitLabWebhookToken != ""
	webhookOnly := cfg.StatusUpdateMode == config.StatusModeWebhook
	switch {
	case url && token:
		return ok(factsOf("mode", cfg.StatusUpdateMode))
	case url && !token:
		// Nothing is registered at all, and in webhook-only mode nothing else
		// advances an order. The portal refuses to start that way, so this can
		// only be seen in hybrid - where it means "polling, silently".
		return verdict(VerdictWarn, reasonURLWithoutToken, factsOf("mode", cfg.StatusUpdateMode))
	case !url && token:
		return verdict(VerdictWarn, reasonTokenWithoutURL, factsOf("mode", cfg.StatusUpdateMode))
	case webhookOnly:
		return verdict(VerdictFail, ReasonNotConfigured, factsOf("mode", cfg.StatusUpdateMode))
	default:
		return verdict(VerdictSkip, ReasonNotConfigured, factsOf("mode", cfg.StatusUpdateMode))
	}
}

// webhookURL compares the address GitLab is told to deliver to with the address
// the portal thinks it is reached at. They legitimately differ (GitLab in a
// container reaches the portal by another name), so a mismatch is a warning with
// both values shown, never a failure - except the path, which has exactly one
// correct value.
func webhookURL(cfg *config.Config) Result {
	if cfg.GitLabWebhookURL == "" {
		return verdict(VerdictSkip, ReasonNotConfigured, nil)
	}
	hook, err := url.Parse(cfg.GitLabWebhookURL)
	if err != nil || hook.Host == "" {
		return verdict(VerdictFail, reasonPathMismatch, factsOf("hook_url", cfg.GitLabWebhookURL))
	}
	f := factsOf("hook_url", cfg.GitLabWebhookURL, "public_url", cfg.PublicURL)
	if strings.TrimRight(hook.Path, "/") != GitLabWebhookPath {
		f["expected_path"] = GitLabWebhookPath
		return verdict(VerdictFail, reasonPathMismatch, f)
	}
	public, err := url.Parse(cfg.PublicURL)
	if err != nil || public.Host == "" {
		return ok(f)
	}
	if hook.Scheme != public.Scheme {
		return verdict(VerdictWarn, reasonSchemeMismatch, f)
	}
	if !strings.EqualFold(hook.Host, public.Host) {
		return verdict(VerdictWarn, reasonHostMismatch, f)
	}
	return ok(f)
}

// instanceDirTemplate checks that the folder template gives every service of one
// team and chart a folder of its own. Two services landing in the same folder
// overwrite each other's values.yaml and application.yaml, and the portal has no
// way to notice: both orders look successful and one service quietly becomes the
// other. An empty template is the bare service name, which is unique by
// construction.
func instanceDirTemplate(tmpl string) Result {
	if strings.TrimSpace(tmpl) == "" {
		return ok(factsOf("rendered", "one"))
	}
	t, err := template.New("instance").Parse(tmpl)
	if err != nil {
		return verdict(VerdictFail, reasonBadTemplate, factsOf("template", tmpl))
	}
	base := tmplSample{Team: "core", Chart: "postgres", ServiceName: "one", Namespace: "apps", Cluster: "in-cluster"}
	other := base
	other.ServiceName = "two"
	first, second := renderTmpl(t, base), renderTmpl(t, other)
	f := factsOf("template", tmpl, "rendered", first, "rendered_other", second)
	if first == second {
		return verdict(VerdictFail, reasonNotUnique, f)
	}
	return ok(f)
}

// appNameTemplate checks the Argo CD application name the same way. Two orders
// rendering one name means two application.yaml files defining the same
// Application, and Argo CD applies whichever it read last. Service names must
// separate them (a failure); team and chart should too, because a name that
// repeats across teams turns one team's order into another team's outage.
func appNameTemplate(tmpl string) Result {
	t, err := template.New("appname").Parse(tmpl)
	if err != nil {
		return verdict(VerdictFail, reasonBadTemplate, factsOf("template", tmpl))
	}
	base := tmplSample{Team: "core", Chart: "postgres", ServiceName: "one"}
	byService, byTeam, byChart := base, base, base
	byService.ServiceName = "two"
	byTeam.Team = "billing"
	byChart.Chart = "redis"
	name := renderTmpl(t, base)
	f := factsOf("template", tmpl, "rendered", name)
	switch {
	case renderTmpl(t, byService) == name:
		return verdict(VerdictFail, reasonNotUnique, f)
	case renderTmpl(t, byTeam) == name:
		return verdict(VerdictWarn, reasonTeamCollision, f)
	case renderTmpl(t, byChart) == name:
		return verdict(VerdictWarn, reasonChartCollision, f)
	}
	return ok(f)
}

// autoMerge reports the portal merging its own merge requests without a human.
// It is a demo setting: on a real GitLab it means a change reaches the cluster
// with nobody having looked at it. Startup logs a warning about it, which is
// read by nobody a week later; this puts it on a page.
func autoMerge(on bool) Result {
	if !on {
		return ok(nil)
	}
	return verdict(VerdictWarn, reasonEnabled, nil)
}

// harborWebhookSecret reports whether Harbor can tell the portal about a pushed
// chart at all. Without the secret the portal only learns about new versions on
// the next poll, which is a delay rather than a failure - unless auto-discovery
// is on and the poll is off, and then a new chart is noticed at the next
// restart.
func harborWebhookSecret(cfg *config.Config) Result {
	if cfg.HarborWebhookKey != "" {
		return ok(nil)
	}
	if cfg.StatusUpdateMode == config.StatusModeWebhook && cfg.CatalogAutodiscover {
		return verdict(VerdictWarn, reasonPollingOnly, factsOf("mode", cfg.StatusUpdateMode))
	}
	return verdict(VerdictSkip, reasonPollingOnly, factsOf("mode", cfg.StatusUpdateMode))
}

// tmplSample is the sample order the templates are rendered against. It mirrors
// provisioning.tmplData - the fields a template may reference - without tying
// this package to the provisioning internals.
type tmplSample struct {
	Team        string
	ServiceName string
	Chart       string
	Namespace   string
	Cluster     string
}

// renderTmpl renders a template against sample data. A template that fails
// halfway (a reference to a field nobody has) still returns what it produced,
// which is exactly what the portal itself would write.
func renderTmpl(t *template.Template, d tmplSample) string {
	var b bytes.Buffer
	_ = t.Execute(&b, d)
	return b.String()
}
