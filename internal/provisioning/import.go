package provisioning

import (
	"context"
	"errors"
	"path"
	"sort"
	"strings"

	"github.com/google/uuid"
	"gopkg.in/yaml.v3"
	"console/internal/gitlab"
	"console/internal/store"
	"console/pkg/models"
)

// ImportFromGit discovers application.yaml manifests committed under the GitOps
// group and adopts any that the portal doesn't already track as IMPORTED orders.
// This makes services created directly in Git (bypassing the portal) visible in
// the catalog. Idempotent: an order whose ArgoCD app name is already known (a
// portal order or a previously imported one) is skipped. Read-only w.r.t. Git.
func (s *Service) ImportFromGit(ctx context.Context) error {
	// Every stand's own path is walked, and what is found there is adopted
	// onto that stand: the path is the one thing that says which stand a
	// manifest belongs to, since a cluster alone cannot (a stand may span
	// several). A store with no stands at all (nothing seeded) walks the
	// configured group and adopts without one, as before.
	stands, err := s.store.ListStands(ctx)
	if err != nil {
		return err
	}
	if len(stands) == 0 {
		stands = []*models.Stand{nil}
	}
	// One stand's path may sit inside another's (a repository under a group),
	// and a group walk sees everything below it. The most specific path claims
	// a manifest first, and the walks above it skip what is already claimed.
	sort.SliceStable(stands, func(i, j int) bool {
		return len(gitPathOf(stands[i])) > len(gitPathOf(stands[j]))
	})
	var discovered []discoveredOn
	claimed := map[string]bool{}
	for _, st := range stands {
		// A stand that keeps its orders in the portal has nothing in Git to
		// adopt, and whatever is under its path is not its orders.
		if !st.WritesGit() {
			continue
		}
		apps, err := s.discoverStand(ctx, st)
		if err != nil {
			return err
		}
		for _, d := range apps {
			key := d.ProjectPath + "\x00" + d.FilePath
			if claimed[key] {
				continue
			}
			claimed[key] = true
			discovered = append(discovered, discoveredOn{d, st})
		}
	}
	// Known identities = the ArgoCD app name of every NON-deleted order. We
	// deliberately exclude fully-deleted orders: a normal delete removes the
	// manifest from Git (so it won't be rediscovered), but if a manifest with the
	// same identity reappears in Git later it's a genuinely new instance and should
	// be re-adopted rather than blocked forever by the old deleted row. In-progress
	// deletes (DELETE_REQUESTED/DELETE_MR_MERGED) are still non-deleted, so they
	// stay in the set and aren't re-imported mid-flight.
	existing, err := s.store.ListRequests(ctx, store.RequestFilter{Admin: true})
	if err != nil {
		return err
	}
	known := make(map[string]struct{}, len(existing))
	for _, r := range existing {
		if r.ArgoCDAppName != "" {
			known[r.ArgoCDAppName] = struct{}{}
		}
	}
	for _, dd := range discovered {
		d := dd.app
		r := s.parseDiscovered(dd.stand, d)
		if r == nil {
			continue // couldn't determine the essential identity - skip
		}
		if _, ok := known[r.ArgoCDAppName]; ok {
			continue
		}
		if dd.stand != nil {
			r.StandID = dd.stand.ID
		}
		// Only adopt VALID, conforming instances:
		//  1) the adjacent values.yaml must exist (a complete instance folder), and
		//  2) the application.yaml must be exactly what the portal would generate for
		//     this order (re-render and compare) - i.e. it follows our GitOps
		//     convention, not some foreign Application we shouldn't manage.
		valuesPath := path.Dir(d.FilePath) + "/values.yaml"
		vb, verr := s.gl.GetFile(ctx, d.ProjectID, valuesPath, d.Branch)
		if verr != nil {
			continue // no values.yaml (or unreadable) - incomplete instance
		}
		expected, rerr := s.renderApp(r, dd.stand, d.ProjectPath, d.ProjectWebURL)
		if rerr != nil || !yamlEqual([]byte(expected), d.Content) {
			continue // application.yaml is not identical to ours - skip
		}
		// values.yaml must satisfy the chart schema - otherwise the adopted order
		// would be un-editable (every edit re-validates the whole values). Skip
		// instances whose values don't validate.
		var vmap map[string]any
		if yaml.Unmarshal(vb, &vmap) != nil {
			continue
		}
		if _, verr := s.validateAndMarshal(ctx, r.ChartProject, r.ChartName, r.ChartVersion, r.Namespace, vmap, true, stampOf(r)); verr != nil {
			continue
		}
		r.ValuesYAML = string(vb)
		// Attribute the order to whoever authored the manifest in Git (best-effort;
		// falls back to the generic "imported" identity set in parseDiscovered).
		if name, email, aerr := s.gl.LastCommitAuthor(ctx, d.ProjectID, d.FilePath, d.Branch); aerr == nil && name != "" {
			r.CreatedByName = name
			if email != "" {
				r.CreatedBy = email
			}
		}
		// Seed the status from current ArgoCD health so the lifecycle reconciler
		// takes over normally; default to DEPLOYING when the app isn't visible yet.
		// On a stand nothing deploys from, the files in Git are the whole story.
		r.Status = models.StatusDeploying
		if !dd.stand.Deploys() {
			r.Status = models.StatusGitSaved
		} else if app, aerr := s.argo.GetApplication(ctx, r.ArgoCDAppName); aerr == nil {
			if st := mapHealth(app.Health); st != "" {
				r.Status = st
			}
		}
		if err := s.store.CreateRequest(ctx, r); err != nil {
			// ErrConflict => an active order already owns this identity; treat as known.
			if errors.Is(err, models.ErrConflict) {
				known[r.ArgoCDAppName] = struct{}{}
			}
			continue
		}
		known[r.ArgoCDAppName] = struct{}{}
		// The portal did not create this repo, so nothing has hooked it: under the
		// per-repository scope its merges would go unnoticed until the next restart
		// swept the group. Done here, at adoption, rather than per discovered app -
		// this runs once per order, the sweep runs every tick.
		if herr := s.Hooks.EnsureProject(ctx, d.ProjectID); herr != nil {
			s.logger().Warn("gitlab webhook not registered on imported repo",
				"order_id", r.ID, "gitlab_project_id", d.ProjectID, "err", herr)
		}
		s.event(ctx, r, bySystem(), "imported", "", r.Status)
		s.publishStatus(r.ID, string(r.Status))
	}
	return nil
}

func gitPathOf(st *models.Stand) string {
	if st == nil {
		return ""
	}
	return st.GitPath
}

// discoveredOn is a manifest with the stand whose path it was found under.
type discoveredOn struct {
	app   gitlab.DiscoveredApp
	stand *models.Stand
}

// discoverStand lists the manifests under a stand's path: the group's
// repositories or the one repository, by layout. A nil stand is the
// configured group.
func (s *Service) discoverStand(ctx context.Context, st *models.Stand) ([]gitlab.DiscoveredApp, error) {
	if st != nil && st.Layout == models.LayoutRepository && st.GitPath != "" {
		return s.gl.DiscoverProjectApplications(ctx, st.GitPath)
	}
	return s.gl.DiscoverGroupApplications(ctx, s.gitops.GroupOf(st))
}

// appManifest is the subset of an application.yaml the importer reads.
type appManifest struct {
	Metadata struct {
		Name   string            `yaml:"name"`
		Labels map[string]string `yaml:"labels"`
	} `yaml:"metadata"`
	Spec struct {
		Destination struct {
			Name      string `yaml:"name"`
			Namespace string `yaml:"namespace"`
		} `yaml:"destination"`
		Sources []appSource `yaml:"sources"`
		Source  appSource   `yaml:"source"`
	} `yaml:"spec"`
}

type appSource struct {
	RepoURL        string `yaml:"repoURL"`
	Chart          string `yaml:"chart"`
	TargetRevision string `yaml:"targetRevision"`
}

// parseDiscovered reconstructs an order from a discovered application.yaml. It
// prefers the portal's idp.* labels, falling back to the repo path / sources so a
// hand-written manifest is still importable. Returns nil if the essential
// identity (team, chart, service) can't be determined.
func (s *Service) parseDiscovered(st *models.Stand, d gitlab.DiscoveredApp) *models.Request {
	var m appManifest
	if err := yaml.Unmarshal(d.Content, &m); err != nil {
		return nil
	}

	// The chart source is the one carrying a chart (multi-source); fall back to a
	// single source.
	chartSrc := m.Spec.Source
	for _, src := range m.Spec.Sources {
		if src.Chart != "" {
			chartSrc = src
			break
		}
	}

	lbl := m.Metadata.Labels
	team := lbl["idp.team"]
	chart := firstNonEmpty(lbl["idp.chart"], chartSrc.Chart)
	service := lbl["idp.service"]

	// Path fallbacks. Under the group layout the team and the chart are the
	// subgroup and the repository ({group}/{subgroup}/{repo}); under the
	// repository layout they are the first two folders of the file path
	// ({team}/{chart}/{cluster}/{namespace}/{instance}/application.yaml).
	if st != nil && st.Layout == models.LayoutRepository {
		fileSegs := strings.Split(strings.Trim(d.FilePath, "/"), "/")
		if team == "" && len(fileSegs) >= 3 {
			team = s.gitops.TeamFromSubgroup(fileSegs[0])
		}
		if chart == "" && len(fileSegs) >= 3 {
			chart = fileSegs[1]
		}
	} else {
		projSegs := strings.Split(strings.Trim(d.ProjectPath, "/"), "/")
		if team == "" && len(projSegs) >= 2 {
			team = s.gitops.TeamFromSubgroup(projSegs[len(projSegs)-2])
		}
		if chart == "" && len(projSegs) >= 1 {
			chart = projSegs[len(projSegs)-1]
		}
	}
	if service == "" {
		service = path.Base(path.Dir(d.FilePath)) // {cluster}/{service}/application.yaml -> service
	}

	team, chart, service = strings.TrimSpace(team), strings.TrimSpace(chart), strings.TrimSpace(service)
	if team == "" || chart == "" || service == "" || service == "." {
		return nil
	}

	cluster := firstNonEmpty(m.Spec.Destination.Name, s.defaultCluster)
	namespace := firstNonEmpty(m.Spec.Destination.Namespace, service)
	appName := firstNonEmpty(m.Metadata.Name, s.gitops.AppName(team, chart, namespace, service))

	return &models.Request{
		ID:            uuid.NewString(),
		CreatedBy:     "git",
		CreatedByName: "Импортировано из Git",
		Team:          team,
		ChartProject:  projectFromRepoURL(chartSrc.RepoURL),
		ChartName:     chart,
		ChartVersion:  chartSrc.TargetRevision,
		ServiceName:   service,
		DisplayName:   service,
		Cluster:       cluster,
		Namespace:     m.Spec.Destination.Namespace,
		ArgoCDAppName: appName,
		// The folder the manifest was found in, whatever it is called. An imported
		// order is adopted where it already lives: rendering the path from the
		// template instead would point the portal at a folder that does not exist.
		InstancePath: path.Dir(d.FilePath),
		// Imported orders adopt existing Git state rather than rendering values, so
		// fall back to service_name (unique per Git folder) for the namespace key.
		ResourceIdentity: service,
		Imported:         true,
	}
}

// projectFromRepoURL extracts the Harbor project from a chart source repoURL like
// "host.docker.internal:8084/platform" -> "platform".
func projectFromRepoURL(repoURL string) string {
	repoURL = strings.TrimRight(repoURL, "/")
	if i := strings.LastIndex(repoURL, "/"); i >= 0 {
		return repoURL[i+1:]
	}
	return ""
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
