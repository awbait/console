package gitlab

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"console/pkg/models"
)

type fakeProject struct {
	proj     Project
	branches map[string]map[string]string // branch -> path -> content
	mrs      map[int]*fakeMR
	nextMR   int
	// commits are frozen snapshots addressable by a synthetic SHA, written when a
	// branch is cut. Real GitLab keeps history; the fake keeps only what the
	// portal reads back - the state a branch forked from, which is the base of a
	// three-way merge once the target branch has moved on.
	commits map[string]map[string]string // sha -> path -> content
	baseSHA map[string]string            // branch -> sha it was cut from
}

type fakeMR struct {
	mr     MR
	source string
	target string
}

// Fake is an in-memory GitLab. It pre-seeds the managed-services group and a
// couple of team subgroups (subgroups are "manual" in production). It also
// exposes merged application.yaml manifests for the fake ArgoCD to reconcile.
type Fake struct {
	mu        sync.Mutex
	topGroup  string
	groups    map[string]*Group       // fullPath -> group
	groupByID map[int]*Group          //
	projects  map[string]*fakeProject // fullPath -> project
	projByID  map[int]*fakeProject
	nextID    int
	autoMerge bool
	clock     func() time.Time

	// Webhook registration (HookAPI). The two flags mimic what an instance
	// refuses: no group hooks on a Free tier, no system hooks without an admin
	// token. Both are off by default, so a bare fake behaves like GitLab CE with
	// a plain token and the cascade lands on per-project hooks.
	groupHooksOK  bool
	systemHooksOK bool
	groupHook     *Hook
	systemHook    *Hook
	projectHooks  map[int]Hook
}

var (
	_ Port    = (*Fake)(nil)
	_ HookAPI = (*Fake)(nil)
)

// NewFake returns a Fake. autoMerge merges open MRs immediately on creation
// (handy for local demo); tests set it false and call MergeMR explicitly.
func NewFake(topGroup string, teamSubgroups []string, autoMerge bool) *Fake {
	f := &Fake{
		topGroup:     topGroup,
		groups:       map[string]*Group{},
		groupByID:    map[int]*Group{},
		projects:     map[string]*fakeProject{},
		projByID:     map[int]*fakeProject{},
		projectHooks: map[int]Hook{},
		nextID:       1,
		autoMerge:    autoMerge,
		clock:        time.Now,
	}
	top := f.addGroup(topGroup)
	for _, sg := range teamSubgroups {
		f.addGroup(top.FullPath + "/" + sg)
	}
	return f
}

func (f *Fake) addGroup(fullPath string) *Group {
	g := &Group{ID: f.nextID, FullPath: fullPath}
	f.nextID++
	f.groups[fullPath] = g
	f.groupByID[g.ID] = g
	return g
}

func (f *Fake) GetGroup(ctx context.Context, fullPath string) (*Group, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	g, ok := f.groups[fullPath]
	if !ok {
		return nil, models.ErrNotFound
	}
	cp := *g
	return &cp, nil
}

func (f *Fake) CreateGroup(ctx context.Context, parentID int, path, _ string) (*Group, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	parent, ok := f.groupByID[parentID]
	if !ok {
		return nil, models.ErrNotFound
	}
	full := parent.FullPath + "/" + path
	if _, exists := f.groups[full]; exists {
		return nil, models.ErrConflict
	}
	g := f.addGroup(full)
	cp := *g
	return &cp, nil
}

func (f *Fake) GetProject(ctx context.Context, fullPath string) (*Project, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	p, ok := f.projects[fullPath]
	if !ok {
		return nil, models.ErrNotFound
	}
	cp := p.proj
	return &cp, nil
}

func (f *Fake) CreateProject(ctx context.Context, namespaceID int, name string) (*Project, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	g, ok := f.groupByID[namespaceID]
	if !ok {
		return nil, fmt.Errorf("namespace %d: %w", namespaceID, models.ErrNotFound)
	}
	fullPath := g.FullPath + "/" + name
	if _, exists := f.projects[fullPath]; exists {
		return nil, models.ErrConflict
	}
	// Empty repo: no default branch yet (mirrors GitLab when a project is created
	// without initialize_with_readme). The first CommitFiles establishes it.
	p := &fakeProject{
		proj:     Project{ID: f.nextID, PathWithNamespace: fullPath, WebURL: "https://gitlab.local/" + fullPath, DefaultBranch: ""},
		branches: map[string]map[string]string{},
		mrs:      map[int]*fakeMR{},
		nextMR:   1,
		commits:  map[string]map[string]string{},
		baseSHA:  map[string]string{},
	}
	f.nextID++
	f.projects[fullPath] = p
	f.projByID[p.proj.ID] = p
	cp := p.proj
	return &cp, nil
}

func (f *Fake) CreateBranch(ctx context.Context, projectID int, branch, ref string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	p, ok := f.projByID[projectID]
	if !ok {
		return models.ErrNotFound
	}
	base, ok := p.branches[ref]
	if !ok {
		return fmt.Errorf("ref %q: %w", ref, models.ErrNotFound)
	}
	cp := map[string]string{}
	for k, v := range base {
		cp[k] = v
	}
	p.branches[branch] = cp
	// Freeze what the branch forked from, addressable by SHA. Both the branch and
	// its target keep moving; this snapshot does not, which is what makes it the
	// base of a later merge.
	sha := fmt.Sprintf("sha%d", f.nextID)
	f.nextID++
	frozen := map[string]string{}
	for k, v := range base {
		frozen[k] = v
	}
	p.commits[sha] = frozen
	p.baseSHA[branch] = sha
	return nil
}

func (f *Fake) CommitFiles(ctx context.Context, projectID int, branch, message string, actions []FileAction) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	p, ok := f.projByID[projectID]
	if !ok {
		return models.ErrNotFound
	}
	files, ok := p.branches[branch]
	if !ok {
		// First commit on an empty repo creates the (default) branch, mirroring
		// GitLab. Otherwise a branch must be created via CreateBranch first.
		if len(p.branches) != 0 {
			return fmt.Errorf("branch %q: %w", branch, models.ErrNotFound)
		}
		files = map[string]string{}
		p.branches[branch] = files
		if p.proj.DefaultBranch == "" {
			p.proj.DefaultBranch = branch
		}
	}
	for _, a := range actions {
		switch a.Action {
		case "create", "update":
			files[a.FilePath] = a.Content
		case "delete":
			delete(files, a.FilePath)
		default:
			return fmt.Errorf("unknown action %q", a.Action)
		}
	}
	return nil
}

// LastCommitAuthor: the fake doesn't track commit authors, so it reports unknown
// and callers fall back to a default attribution.
func (f *Fake) LastCommitAuthor(ctx context.Context, projectID int, path, ref string) (string, string, error) {
	return "", "", nil
}

func (f *Fake) GetFile(ctx context.Context, projectID int, path, ref string) ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	p, ok := f.projByID[projectID]
	if !ok {
		return nil, models.ErrNotFound
	}
	files, ok := p.branches[ref]
	if !ok {
		// A ref is a branch or a commit, and the portal reads both: the base of a
		// three-way merge is addressed by SHA, not by branch name.
		files, ok = p.commits[ref]
	}
	if !ok {
		return nil, models.ErrNotFound
	}
	content, ok := files[path]
	if !ok {
		return nil, models.ErrNotFound
	}
	return []byte(content), nil
}

func (f *Fake) ListTree(ctx context.Context, projectID int, branch, path string) ([]string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	p, ok := f.projByID[projectID]
	if !ok {
		return nil, models.ErrNotFound
	}
	files, ok := p.branches[branch]
	if !ok {
		return nil, models.ErrNotFound
	}
	prefix := strings.TrimSuffix(path, "/") + "/"
	var out []string
	for fp := range files {
		if strings.HasPrefix(fp, prefix) {
			out = append(out, fp)
		}
	}
	return out, nil
}

func (f *Fake) CreateMR(ctx context.Context, projectID int, source, target, title string) (*MR, error) {
	f.mu.Lock()
	p, ok := f.projByID[projectID]
	if !ok {
		f.mu.Unlock()
		return nil, models.ErrNotFound
	}
	iid := p.nextMR
	p.nextMR++
	m := &fakeMR{
		mr: MR{IID: iid, ProjectID: projectID, State: models.MROpened,
			SourceBranch: source,
			WebURL:       fmt.Sprintf("%s/-/merge_requests/%d", p.proj.WebURL, iid)},
		source: source, target: target,
	}
	m.mr.DiffRefs.BaseSHA = p.baseSHA[source]
	p.mrs[iid] = m
	auto := f.autoMerge
	cp := m.mr
	f.mu.Unlock()

	if auto {
		_ = f.MergeMR(ctx, projectID, iid)
		if merged, err := f.GetMR(ctx, projectID, iid); err == nil {
			cp = *merged
		}
	}
	return &cp, nil
}

func (f *Fake) GetMR(ctx context.Context, projectID, iid int) (*MR, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	p, ok := f.projByID[projectID]
	if !ok {
		return nil, models.ErrNotFound
	}
	m, ok := p.mrs[iid]
	if !ok {
		return nil, models.ErrNotFound
	}
	cp := m.mr
	return &cp, nil
}

// CloseMR closes an open MR without touching the branches.
func (f *Fake) CloseMR(ctx context.Context, projectID, iid int) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	p, ok := f.projByID[projectID]
	if !ok {
		return models.ErrNotFound
	}
	m, ok := p.mrs[iid]
	if !ok {
		return models.ErrNotFound
	}
	if m.mr.State == models.MROpened {
		m.mr.State = models.MRClosed
	}
	return nil
}

func (f *Fake) Healthz(ctx context.Context) error { return nil }

// --- test/demo controls (not part of Port) ---

// SetDetailedMergeStatus makes the fake report a mergeability status for an MR,
// the way GitLab does (see ClassifyMerge). Empty is the default and means "not
// reported", so tests that do not care keep the plain always-mergeable fake.
func (f *Fake) SetDetailedMergeStatus(projectID, iid int, status string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	p, ok := f.projByID[projectID]
	if !ok {
		return models.ErrNotFound
	}
	m, ok := p.mrs[iid]
	if !ok {
		return models.ErrNotFound
	}
	m.mr.DetailedMergeStatus = status
	return nil
}

// MergeMR merges the source branch into the target branch and marks the MR merged.
func (f *Fake) MergeMR(ctx context.Context, projectID, iid int) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	p, ok := f.projByID[projectID]
	if !ok {
		return models.ErrNotFound
	}
	m, ok := p.mrs[iid]
	if !ok {
		return models.ErrNotFound
	}
	if m.mr.State != models.MROpened {
		return nil
	}
	src := p.branches[m.source]
	dst := p.branches[m.target]
	if dst == nil {
		dst = map[string]string{}
		p.branches[m.target] = dst
	}
	// apply source as the new target content (create/update/delete diffs)
	for k := range dst {
		if _, stillThere := src[k]; !stillThere {
			delete(dst, k)
		}
	}
	for k, v := range src {
		dst[k] = v
	}
	m.mr.State = models.MRMerged
	return nil
}

// ListApplicationManifests returns every application.yaml on default branches.
// Implements the argocd manifest source so the fake ArgoCD can reconcile.
func (f *Fake) ListApplicationManifests(ctx context.Context) ([][]byte, error) {
	apps, _ := f.DiscoverApplications(ctx)
	out := make([][]byte, 0, len(apps))
	for _, a := range apps {
		out = append(out, a.Content)
	}
	return out, nil
}

// SetHookAvailability chooses which webhook scopes this fake instance accepts,
// standing in for the tier (group hooks) and the token's role (system hooks).
// Everything else falls through to per-project hooks, as GitLab CE does.
func (f *Fake) SetHookAvailability(group, system bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.groupHooksOK, f.systemHooksOK = group, system
}

// Hooks returns the registered hooks: the group one, the system one (nil when
// absent) and the per-project ones keyed by project ID.
func (f *Fake) Hooks() (group, system *Hook, project map[int]Hook) {
	f.mu.Lock()
	defer f.mu.Unlock()
	project = map[int]Hook{}
	for id, h := range f.projectHooks {
		project[id] = h
	}
	return f.groupHook, f.systemHook, project
}

func (f *Fake) EnsureGroupHook(ctx context.Context, groupPath string, h Hook) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.groupHooksOK {
		return fmt.Errorf("%w: fake instance has no group hooks", ErrScopeUnavailable)
	}
	if _, ok := f.groups[groupPath]; !ok {
		return fmt.Errorf("gitlab: group %q: %w", groupPath, models.ErrNotFound)
	}
	f.groupHook = &h
	return nil
}

func (f *Fake) EnsureSystemHook(ctx context.Context, h Hook) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.systemHooksOK {
		return fmt.Errorf("%w: fake token is not an admin", ErrScopeUnavailable)
	}
	f.systemHook = &h
	return nil
}

func (f *Fake) EnsureProjectHook(ctx context.Context, projectID int, h Hook) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, ok := f.projByID[projectID]; !ok {
		return models.ErrNotFound
	}
	f.projectHooks[projectID] = h
	return nil
}

func (f *Fake) ListGroupProjects(ctx context.Context) ([]Project, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []Project
	for _, p := range f.projects {
		if strings.HasPrefix(p.proj.PathWithNamespace, f.topGroup+"/") {
			out = append(out, p.proj)
		}
	}
	// Stable order: callers register hooks in it, and tests compare it.
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

// DiscoverApplications returns every application.yaml on default branches with
// its location. Implements gitlab.Port.
func (f *Fake) DiscoverApplications(ctx context.Context) ([]DiscoveredApp, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []DiscoveredApp
	for _, p := range f.projByID {
		branch := p.proj.DefaultBranch
		for fp, content := range p.branches[branch] {
			if strings.HasSuffix(fp, "application.yaml") || strings.HasSuffix(fp, "application.yml") {
				out = append(out, DiscoveredApp{
					ProjectID: p.proj.ID, ProjectPath: p.proj.PathWithNamespace, ProjectWebURL: p.proj.WebURL,
					Branch: branch, FilePath: fp, Content: []byte(content),
				})
			}
		}
	}
	return out, nil
}
