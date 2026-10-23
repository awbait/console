package models

import (
	"regexp"
	"time"
)

// Stand is a deployment target an order is placed on: a named place with its
// own default cluster and, later, its own variable values, Git layout and
// mode. A stand may span several clusters, so the cluster itself stays a field
// of the order; the stand only says which one an order starts with.
//
// It is a global entity, not a team's: every team orders onto the same stands
// and sees only its own orders there. Orders are attached to a stand at
// creation and keep it for good, the way they keep their namespace: the stand
// decides where the files go and which variable values apply, and moving
// either is a different order (see the copy-to-stand action).
type Stand struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// DefaultCluster is the Argo CD destination.name the order form opens with
	// for this stand. The order may name another cluster of the same stand; what
	// it names is what it keeps (Request.Cluster).
	DefaultCluster string `json:"default_cluster"`
	// Default marks the stand an order lands on when none is named, and the one
	// every order written before stands existed was attached to. Exactly one
	// stand carries it; moving it is its own operation (SetDefaultStand).
	Default bool `json:"default"`
	// Layout is how the stand's orders are laid out in Git (LayoutGroup or
	// LayoutRepository), GitPath where: the full GitLab path of the group the
	// team subgroups live under, or of the one repository every order of the
	// stand is a folder in. Both are fixed while the stand has orders: moving
	// them would mean moving folders in Git.
	Layout  string `json:"layout"`
	GitPath string `json:"git_path"`
	// Mode is how far an order on the stand goes: written to Git and deployed
	// by Argo CD (ModeDeploy), written to Git and left there (ModeGit), or kept
	// in the portal only (ModeConsole). Fixed while the stand has orders, like
	// the layout: the orders already placed went as far as the mode said.
	Mode string `json:"mode"`
	// ChartRegistry is the registry the stand's application manifests take
	// their chart from, "{ChartRegistry}/{chart_project}". Empty means the
	// platform's configured registry (CHART_REGISTRY).
	ChartRegistry string `json:"chart_registry"`
	// GitURL is the GitLab the stand's Argo CD reads values from, as it sees
	// it: another address of the portal's GitLab, or a mirror. Only the
	// scheme and host part of the application's repoURL come from here; the
	// path is GitPath's unless ArgoGitPath says otherwise. Empty means the
	// address the portal itself uses.
	GitURL string `json:"git_url"`
	// ArgoGitPath is the path the stand's Argo CD reads the orders' files
	// under, when it is not GitPath: the repository was mirrored or moved to
	// another path, and the application's repoURL has to name that one. It
	// replaces GitPath in the repoURL and in the stand's manifests, and
	// nothing else: the portal keeps writing under GitPath. Under the group
	// layout the team subgroup and the chart repository follow it the way
	// they follow GitPath. Empty means GitPath.
	ArgoGitPath string `json:"argocd_git_path"`
	// ArgoNamespace is the namespace the stand's Argo CD runs in, where its
	// Applications live. Empty means ARGOCD_NAMESPACE.
	ArgoNamespace string `json:"argocd_namespace"`
	// ArgoProject is the Argo CD project the stand's applications belong to,
	// their spec.project. Empty means ARGOCD_PROJECT. Changing it does not
	// move the orders already placed: each one takes it when its application
	// is rendered next.
	ArgoProject string `json:"argocd_project"`
	// ArgoConnected reports that Argo CD sees the stand's applications, as the
	// stand's last application check found. Set by the checks, never by hand:
	// true until a check with live orders finds none of them, so a stand nobody
	// has looked at is not called disconnected. While it is false, orders of
	// the stand wait after their merge, and the order page says what for.
	ArgoConnected bool `json:"argo_connected"`
	// CheckedAt is when the stand's checks last ran; nil before the first.
	CheckedAt *time.Time `json:"checked_at,omitempty"`
	// Job is the job running on the stand right now, if any. Computed on
	// read, never stored with the stand.
	Job *StandJob `json:"job,omitempty"`
	// Locked reports that the stand has orders beyond drafts and deleted ones,
	// so its layout, path and mode are read-only. Computed on read, never stored.
	Locked bool `json:"locked"`
	// StorageCreated reports that the portal made the stand's group or
	// repository in GitLab itself, so it may remove it with the stand.
	StorageCreated bool `json:"storage_created"`
	// DeletedAt is when the stand was deleted. A deleted stand is gone from
	// every list; the row stays for the history of the orders it had.
	DeletedAt *time.Time `json:"deleted_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

// StandCheck is the stored outcome of one check of a stand (see
// internal/checks.Stand): identifiers only, the front end owns the wording.
type StandCheck struct {
	StandID   string            `json:"-"`
	ID        string            `json:"id"`
	Component string            `json:"component"`
	Verdict   string            `json:"verdict"`
	Reason    string            `json:"reason,omitempty"`
	Facts     map[string]string `json:"facts,omitempty"`
	CheckedAt time.Time         `json:"checked_at"`
}

// The two layouts of a stand in Git.
const (
	// LayoutGroup: under GitPath there is a subgroup per team and a repository
	// per chart in it, and every order is a folder of its chart repository.
	// The layout every order had before stands existed; GitLab's own access
	// control falls on the team subgroups.
	LayoutGroup = "group"
	// LayoutRepository: GitPath is one repository and every order of the stand
	// is a folder in it, under its team and chart. One place to read and one
	// webhook, at the cost of the per-team isolation GitLab gives subgroups.
	LayoutRepository = "repository"
)

// ValidLayout reports whether s names a layout.
func ValidLayout(s string) bool { return s == LayoutGroup || s == LayoutRepository }

// The three modes of a stand.
const (
	// ModeDeploy: files in Git, a merge request, and Argo CD deploying what
	// was merged while the portal follows its status. How every order worked
	// before stands existed.
	ModeDeploy = "deploy"
	// ModeGit: the same files and merge request, and nothing after the merge:
	// the order ends in StatusGitSaved, and whatever applies the files is not
	// the portal's business.
	ModeGit = "git"
	// ModeConsole: nothing in Git at all. The order is kept in the portal and
	// ends in StatusConsoleSaved as soon as it is placed.
	ModeConsole = "console"
)

// ValidMode reports whether s names a mode.
func ValidMode(s string) bool { return s == ModeDeploy || s == ModeGit || s == ModeConsole }

// WritesGit reports whether orders of the stand are written to Git. A nil
// stand and a stand written before modes existed answer as ModeDeploy, the
// behaviour every order had.
func (s *Stand) WritesGit() bool { return s == nil || s.Mode != ModeConsole }

// Deploys reports whether Argo CD deploys the stand's orders and the portal
// follows them there.
func (s *Stand) Deploys() bool { return s == nil || s.Mode == "" || s.Mode == ModeDeploy }

// chartRegistryRe is a registry host with an optional port and path, the way
// CHART_REGISTRY is written: no scheme, because it lands in an OCI repoURL.
var chartRegistryRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?(/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$`)

// ValidChartRegistry reports whether r may be a stand's chart registry.
func ValidChartRegistry(r string) bool { return len(r) <= MaxGitPath && chartRegistryRe.MatchString(r) }

// gitURLRe is a GitLab base address: http or https, a host, an optional port
// and path (a GitLab under a relative URL), nothing after it.
var gitURLRe = regexp.MustCompile(`^https?://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?(/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$`)

// ValidGitURL reports whether u may be a stand's Git address for Argo CD.
func ValidGitURL(u string) bool { return len(u) <= MaxGitPath && gitURLRe.MatchString(u) }

// gitPathRe is what GitLab accepts as a full path: segments of letters,
// digits, dots, dashes and underscores, separated by slashes. Checked here
// because the path lands in API calls and in rendered manifests.
var gitPathRe = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.-]*(/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$`)

// MaxGitPath bounds the path the way GitLab does.
const MaxGitPath = 255

// ValidGitPath reports whether p may be a stand's group or repository path.
func ValidGitPath(p string) bool { return len(p) <= MaxGitPath && gitPathRe.MatchString(p) }

// DefaultStandName is what the stand created on the first start after the
// upgrade is called. It is seeded from the configured default cluster so every
// existing order attaches to it without changing where it lives; an admin
// renames it from the stands page.
const DefaultStandName = "default"

// MaxStandName bounds the name: it is shown in a selector, a table column and a
// filter chip, none of which has room for a sentence.
const MaxStandName = 64
