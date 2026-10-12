package checks

import (
	"context"
	"errors"
	"sort"
	"strconv"
	"strings"

	"console/internal/argocd"
	"console/internal/gitlab"
	"console/pkg/models"
)

// Checks of one stand, run when its page is opened rather than in the
// background round: they are about the stand's own path and clusters, which
// the configured set knows nothing about, and the page is where they are
// read. Same rules as the rest of the package: reads only, identifiers only.

// Check ids of the stand set, mirrored in web/src/features/stands/text.ts.
const (
	IDStandGit     = "stand_git"      // the token reaches the stand's group or repository
	IDStandCluster = "stand_cluster"  // the clusters its orders go to are registered
	IDStandArgo    = "stand_argo_app" // Argo CD sees the stand's applications
)

// Reasons the stand checks return, beside the shared ones.
const (
	reasonPathEmpty   = "path_empty"   // the stand names no path yet (made before paths existed)
	reasonRepoMissing = "repo_missing" // the stand's repository is not there under that path
	reasonRepoFound   = "repo_found"   // it is
	reasonNoOrders    = "no_orders"    // nothing deployed from this stand yet
	reasonAppsMissing = "apps_missing" // none of the stand's applications is in Argo CD
	reasonAppsPartial = "apps_partial" // some are, some are not
	reasonAppsFound   = "apps_found"   // every one looked at is there
)

// StandArgoAPI is what the Argo CD checks of a stand read through.
type StandArgoAPI interface {
	ListClusters(ctx context.Context) ([]argocd.Cluster, error)
	GetApplication(ctx context.Context, name string) (*argocd.Application, error)
}

// standAppsLimit bounds how many of a stand's applications are looked up:
// enough to tell "none" from "some" without walking a thousand orders.
const standAppsLimit = 10

// Stand runs the checks of one stand against its live orders. Either API may
// be nil (a test, a portal without that upstream): its checks say so.
func Stand(ctx context.Context, gl GitLabAPI, argo StandArgoAPI, st *models.Stand, orders []*models.Request) []CheckResult {
	live := make([]*models.Request, 0, len(orders))
	for _, r := range orders {
		if r.DeletedAt == nil && r.Status != models.StatusDraft && r.Status != models.StatusDeleted {
			live = append(live, r)
		}
	}
	return []CheckResult{
		result(IDStandGit, ComponentGitLab, standGit(ctx, gl, st)),
		result(IDStandCluster, ComponentArgoCD, standClusters(ctx, argo, st, live)),
		result(IDStandArgo, ComponentArgoCD, standApps(ctx, argo, live)),
	}
}

func result(id, component string, r Result) CheckResult {
	return CheckResult{ID: id, Component: component, Verdict: r.Verdict, Reason: r.Reason, Facts: r.Facts}
}

// standGit checks the stand's path the way the configured group is checked:
// it is there, and the token's role in it covers what the portal does. Under
// the repository layout the repository itself is looked up, and the role is
// read on the group it is in.
func standGit(ctx context.Context, api GitLabAPI, st *models.Stand) Result {
	if api == nil {
		return verdict(VerdictUnknown, ReasonUnavailable, nil)
	}
	if st.GitPath == "" {
		return verdict(VerdictFail, reasonPathEmpty, nil)
	}
	if st.Layout != models.LayoutRepository {
		// Subgroups are created under the stand's group, so the role asked for
		// is the one that may do that.
		return gitlabGroup(ctx, api, st.GitPath, true)
	}
	f := map[string]string{"path": st.GitPath}
	p, err := api.GetProject(ctx, st.GitPath)
	switch {
	case errors.Is(err, models.ErrNotFound):
		// The repository is made on the first order; what has to exist is the
		// group it will be made in.
		if i := strings.LastIndex(st.GitPath, "/"); i > 0 {
			r := gitlabGroup(ctx, api, st.GitPath[:i], false)
			if r.Verdict == VerdictOK {
				return verdict(VerdictWarn, reasonRepoMissing, f)
			}
			return r
		}
		return verdict(VerdictFail, reasonRepoMissing, f)
	case errors.Is(err, gitlab.ErrForbidden):
		return verdict(VerdictFail, ReasonForbidden, f)
	case err != nil:
		return verdict(VerdictUnknown, ReasonUnavailable, f)
	}
	f["project_id"] = strconv.Itoa(p.ID)
	return verdict(VerdictOK, reasonRepoFound, f)
}

// standClusters checks that every cluster the stand's orders go to, and the
// one its form opens with, is registered in Argo CD.
func standClusters(ctx context.Context, api StandArgoAPI, st *models.Stand, live []*models.Request) Result {
	if api == nil {
		return verdict(VerdictUnknown, ReasonUnavailable, nil)
	}
	want := map[string]bool{}
	if st.DefaultCluster != "" {
		want[st.DefaultCluster] = true
	}
	for _, r := range live {
		if r.Cluster != "" {
			want[r.Cluster] = true
		}
	}
	names := make([]string, 0, len(want))
	for c := range want {
		names = append(names, c)
	}
	sort.Strings(names)
	f := map[string]string{"clusters": strings.Join(names, ", ")}
	list, err := api.ListClusters(ctx)
	switch {
	case err != nil && argocd.Forbidden(err):
		return verdict(VerdictUnknown, ReasonForbidden, f)
	case err != nil:
		return verdict(VerdictUnknown, ReasonUnavailable, f)
	}
	registered := map[string]bool{}
	for _, c := range list {
		registered[c.Name] = true
		registered[c.Server] = true
	}
	var missing []string
	for _, c := range names {
		if !registered[c] {
			missing = append(missing, c)
		}
	}
	if len(missing) > 0 {
		f["missing"] = strings.Join(missing, ", ")
		return verdict(VerdictFail, reasonClusterMissing, f)
	}
	return verdict(VerdictOK, reasonClusterFound, f)
}

// standApps asks Argo CD for a few of the stand's applications. A stand
// without orders has nothing to look for and says so quietly; a stand whose
// orders Argo CD knows nothing about is not wired, whatever the manifests on
// its page say.
func standApps(ctx context.Context, api StandArgoAPI, live []*models.Request) Result {
	if api == nil {
		return verdict(VerdictUnknown, ReasonUnavailable, nil)
	}
	if len(live) == 0 {
		return verdict(VerdictSkip, reasonNoOrders, nil)
	}
	found, looked := 0, 0
	for _, r := range live {
		if r.ArgoCDAppName == "" || looked >= standAppsLimit {
			continue
		}
		looked++
		_, err := api.GetApplication(ctx, r.ArgoCDAppName)
		switch {
		case err == nil:
			found++
		case errors.Is(err, models.ErrNotFound):
		case argocd.Forbidden(err):
			return verdict(VerdictUnknown, ReasonForbidden, nil)
		default:
			return verdict(VerdictUnknown, ReasonUnavailable, nil)
		}
	}
	f := map[string]string{"looked": strconv.Itoa(looked), "found": strconv.Itoa(found)}
	switch {
	case looked == 0:
		return verdict(VerdictSkip, reasonNoOrders, nil)
	case found == 0:
		return verdict(VerdictFail, reasonAppsMissing, f)
	case found < looked:
		return verdict(VerdictWarn, reasonAppsPartial, f)
	}
	return verdict(VerdictOK, reasonAppsFound, f)
}
