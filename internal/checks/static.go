package checks

import (
	"bytes"
	"context"
	"strings"
	"text/template"

	"console/internal/config"
)

// Static checks read the configuration and nothing else: no network, no
// upstream, no clock. They are the ones that catch a deployment where two
// settings disagree with each other - the kind of mistake that stays invisible
// until the first order lands on it.
//
// They also say nothing when they pass, and that is the difference between them
// and every other check here. A check that reached an upstream reports success
// too, because "the token may open merge requests" is a thing somebody learned
// by looking and cannot see in the row. A static check only computes a property
// of the value printed in that same row, so its green tells the reader nothing
// they could not work out; only its failure is news. Hence VerdictSilent on the
// way out.

// Check ids of the static set, mirrored in web/src/app/configChecks.ts.
const (
	IDInstanceDirTmpl = "instance_dir_template"
	IDAppNameTmpl     = "app_name_template"
)

// GITLAB_AUTO_MERGE has no check on purpose. A check has to observe something
// the row does not already show, and "auto-merge is on" is the value of the
// setting, restated. Worse, the portal cannot tell a stand from production, so
// the verdict would be a warning nobody can ever close, and a warning that is
// always on is what hides the ones that are not. Startup still logs it.

// Reasons the static checks return. The webhook ones live here too: the checks
// that use them are about a webhook, not about a template, but the sentences
// they map to are the portal's own configuration either way.
const (
	reasonURLWithoutToken = "url_without_token" // GitLab is told where to deliver, and the portal registers nothing without a secret
	reasonTokenWithoutURL = "token_without_url" // the portal will accept deliveries nobody registered
	reasonSchemeMismatch  = "scheme_mismatch"   // https hook against an http portal, or the other way round
	reasonHostMismatch    = "host_mismatch"     // the hook points at a different host than the portal's own address
	reasonPathMismatch    = "path_mismatch"     // the hook points at something that is not the portal's webhook endpoint
	reasonNotUnique       = "not_unique"        // the template gives two different services the same name
	reasonTeamCollision   = "team_collision"    // the template gives two teams the same application name
	reasonChartCollision  = "chart_collision"   // the template gives two charts the same application name
	reasonBadTemplate     = "bad_template"      // the template does not parse
	reasonUnique          = "unique"            // it does tell services apart, which is not news
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
	}
}

// instanceDirTemplate checks that the folder template gives every service of one
// team and chart a folder of its own. Two services landing in the same folder
// overwrite each other's values.yaml and application.yaml, and the portal has no
// way to notice: both orders look successful and one service quietly becomes the
// other. An empty template is the bare service name, which is unique by
// construction.
func instanceDirTemplate(tmpl string) Result {
	if strings.TrimSpace(tmpl) == "" {
		return silent(reasonUnique)
	}
	t, err := template.New("instance").Parse(tmpl)
	if err != nil {
		return verdict(VerdictFail, reasonBadTemplate, nil)
	}
	base := tmplSample{Team: "core", Chart: "postgres", ServiceName: "one", Namespace: "apps", Cluster: "in-cluster"}
	other := base
	other.ServiceName = "two"
	// What the template renders to is not reported: the template itself is right
	// there in the row this verdict hangs on, and a worked example of it is one
	// more thing to read for no decision.
	if renderTmpl(t, base) == renderTmpl(t, other) {
		return verdict(VerdictFail, reasonNotUnique, nil)
	}
	return silent(reasonUnique)
}

// appNameTemplate checks the Argo CD application name the same way. Two orders
// rendering one name means two application.yaml files defining the same
// Application, and Argo CD applies whichever it read last. Service names must
// separate them (a failure); team and chart should too, because a name that
// repeats across teams turns one team's order into another team's outage.
func appNameTemplate(tmpl string) Result {
	t, err := template.New("appname").Parse(tmpl)
	if err != nil {
		return verdict(VerdictFail, reasonBadTemplate, nil)
	}
	base := tmplSample{Team: "core", Chart: "postgres", ServiceName: "one"}
	byService, byTeam, byChart := base, base, base
	byService.ServiceName = "two"
	byTeam.Team = "billing"
	byChart.Chart = "redis"
	name := renderTmpl(t, base)
	switch {
	case renderTmpl(t, byService) == name:
		return verdict(VerdictFail, reasonNotUnique, nil)
	case renderTmpl(t, byTeam) == name:
		return verdict(VerdictWarn, reasonTeamCollision, nil)
	case renderTmpl(t, byChart) == name:
		return verdict(VerdictWarn, reasonChartCollision, nil)
	}
	return silent(reasonUnique)
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
