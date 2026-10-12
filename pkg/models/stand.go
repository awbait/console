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
	// Locked reports that the stand has orders beyond drafts and deleted ones,
	// so its layout and path are read-only. Computed on read, never stored.
	Locked    bool      `json:"locked"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
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
