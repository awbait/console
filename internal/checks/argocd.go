package checks

import (
	"context"
	"strconv"
	"strings"

	"console/internal/argocd"
	"console/internal/config"
)

// Check ids of the Argo CD set, mirrored in web/src/app/configChecks.ts.
const (
	IDArgoProject     = "argocd_project"
	IDArgoPermissions = "argocd_permissions"
	IDArgoCluster     = "argocd_cluster"
	IDArgoNamespace   = "argocd_namespace"
)

// Reasons the Argo CD checks return.
const (
	reasonProjectMissing = "project_missing" // the project the portal commits into is not there
	reasonClusterMissing = "cluster_missing" // the destination cluster is not registered
	reasonCannotRead     = "cannot_read"     // the token may not read the applications it reports on
	reasonCannotSync     = "cannot_sync"     // it may read them but not sync them
	reasonNamespaceDiff  = "namespace_diff"  // applications are committed where Argo CD does not look
	reasonNoApplications = "no_applications" // nothing deployed yet, so nothing to compare with
)

// ArgoCDAPI is the slice of the Argo CD client the checks read through.
type ArgoCDAPI interface {
	ProjectExists(ctx context.Context, name string) (bool, error)
	ListClusters(ctx context.Context) ([]argocd.Cluster, error)
	CanI(ctx context.Context, resource, action, subresource string) (bool, error)
	ApplicationNamespace(ctx context.Context) (string, error)
}

// ArgoCDChecks builds the Argo CD set. Everything here is about the far end of
// an order: by the time it matters the change is already merged, out of the
// portal's hands and out of its logs.
func ArgoCDChecks(cfg *config.Config, api ArgoCDAPI) []Check {
	return []Check{
		{
			ID:        IDArgoProject,
			Component: ComponentArgoCD,
			Vars:      []string{"ARGOCD_PROJECT"},
			Run:       func(ctx context.Context) Result { return argoProject(ctx, api, cfg.ArgoCDProject) },
		},
		{
			ID:        IDArgoPermissions,
			Component: ComponentArgoCD,
			Vars:      []string{"ARGOCD_TOKEN", "ARGOCD_PROJECT"},
			Run:       func(ctx context.Context) Result { return argoPermissions(ctx, api, cfg.ArgoCDProject) },
		},
		{
			ID:        IDArgoCluster,
			Component: ComponentArgoCD,
			Vars:      []string{"ARGOCD_DEFAULT_CLUSTER"},
			Run:       func(ctx context.Context) Result { return argoCluster(ctx, api, cfg.ArgoCDCluster) },
		},
		{
			ID:        IDArgoNamespace,
			Component: ComponentArgoCD,
			Vars:      []string{"ARGOCD_NAMESPACE"},
			Run:       func(ctx context.Context) Result { return argoNamespace(ctx, api, cfg.ArgoCDNamespace) },
		},
	}
}

// argoProject checks that the project every generated application.yaml names
// exists. Argo CD refuses an Application whose project it does not know, and it
// refuses it long after the portal has reported the order as merged.
func argoProject(ctx context.Context, api ArgoCDAPI, project string) Result {
	if api == nil {
		return verdict(VerdictUnknown, ReasonUnavailable, nil)
	}
	f := map[string]string{}
	exists, err := api.ProjectExists(ctx, project)
	switch {
	case err != nil && argocd.Forbidden(err):
		return verdict(VerdictUnknown, ReasonForbidden, f)
	case err != nil:
		return verdict(VerdictUnknown, ReasonUnavailable, f)
	case !exists:
		return verdict(VerdictFail, reasonProjectMissing, f)
	}
	return ok(f)
}

// argoPermissions asks Argo CD what this token may do, which is the one question
// it answers without changing anything. Reading applications is what the order
// status is built from; syncing is the admin action on an order page.
func argoPermissions(ctx context.Context, api ArgoCDAPI, project string) Result {
	if api == nil {
		return verdict(VerdictUnknown, ReasonUnavailable, nil)
	}
	// Named apart from the webhook "scope": the two are unrelated and the page
	// labels facts by their key.
	scope := project + "/*"
	f := factsOf("rbac_scope", scope)
	canRead, err := api.CanI(ctx, "applications", "get", scope)
	if err != nil {
		// Older servers, and some proxies in front of them, do not route this
		// endpoint. Not being able to ask is not the same as being refused.
		return verdict(VerdictUnknown, ReasonUnavailable, f)
	}
	f["read"] = strconv.FormatBool(canRead)
	if !canRead {
		return verdict(VerdictFail, reasonCannotRead, f)
	}
	canSync, err := api.CanI(ctx, "applications", "sync", scope)
	if err != nil {
		return ok(f)
	}
	f["sync"] = strconv.FormatBool(canSync)
	if !canSync {
		return verdict(VerdictWarn, reasonCannotSync, f)
	}
	return ok(f)
}

// argoCluster checks that the cluster orders are deployed to by default is
// registered. An Application pointing at an unregistered cluster is accepted and
// then sits unsynced with a message nobody in the portal ever sees.
func argoCluster(ctx context.Context, api ArgoCDAPI, cluster string) Result {
	if api == nil {
		return verdict(VerdictUnknown, ReasonUnavailable, nil)
	}
	f := map[string]string{}
	list, err := api.ListClusters(ctx)
	switch {
	case err != nil && argocd.Forbidden(err):
		// A project-scoped token may not list clusters. Common and harmless.
		return verdict(VerdictUnknown, ReasonForbidden, f)
	case err != nil:
		return verdict(VerdictUnknown, ReasonUnavailable, f)
	}
	names := make([]string, 0, len(list))
	for _, c := range list {
		names = append(names, c.Name)
		if c.Name == cluster || c.Server == cluster {
			return ok(f)
		}
	}
	f["registered"] = strings.Join(names, ", ")
	return verdict(VerdictFail, reasonClusterMissing, f)
}

// argoNamespace compares the namespace the portal writes into every generated
// application.yaml with the one Argo CD actually reads Applications from. Get
// this wrong and the order is merged, applied by the app-of-apps, and then read
// by nobody: the service never comes up and nothing anywhere says why.
func argoNamespace(ctx context.Context, api ArgoCDAPI, configured string) Result {
	if api == nil {
		return verdict(VerdictUnknown, ReasonUnavailable, nil)
	}
	f := map[string]string{}
	actual, err := api.ApplicationNamespace(ctx)
	switch {
	case err != nil && argocd.Forbidden(err):
		return verdict(VerdictUnknown, ReasonForbidden, f)
	case err != nil:
		return verdict(VerdictUnknown, ReasonUnavailable, f)
	case actual == "":
		// Argo CD does not report its own namespace, so the only witness is an
		// application it already holds. With none, there is nothing to compare -
		// and nothing to say. A portal that has not deployed anything yet cannot
		// have got this wrong yet, and a row saying so is a row nobody can act on.
		return silent(reasonNoApplications)
	}
	f["actual"] = actual
	if actual != configured {
		return verdict(VerdictFail, reasonNamespaceDiff, f)
	}
	return ok(f)
}
