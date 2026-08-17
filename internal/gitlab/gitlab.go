// Package gitlab defines the GitLab port and shared types. The GitOps layout
// is a group of repositories: managed-services/{subgroup}/{chart}/{service}/.
package gitlab

import (
	"context"

	"console/pkg/models"
)

// Group is a GitLab group/subgroup.
type Group struct {
	ID       int    `json:"id"`
	FullPath string `json:"full_path"`
}

// Project is a GitLab repository.
type Project struct {
	ID                int    `json:"id"`
	PathWithNamespace string `json:"path_with_namespace"`
	WebURL            string `json:"web_url"`
	DefaultBranch     string `json:"default_branch"`
}

// MR is a merge request.
type MR struct {
	IID            int             `json:"iid"`
	ProjectID      int             `json:"project_id"`
	WebURL         string          `json:"web_url"`
	State          models.MRStatus `json:"state"`
	SourceBranch   string          `json:"source_branch"`
	MergeCommitSHA string          `json:"merge_commit_sha"` // set once merged; the target git revision
	// DiffRefs names the commits this MR is measured against. BaseSHA is the one
	// the branch was cut from, which is the only record of what the target branch
	// held when the change was written - the base of a three-way merge when the
	// target has moved since. GitLab reports it for as long as the branch exists.
	DiffRefs struct {
		BaseSHA string `json:"base_sha"`
		HeadSHA string `json:"head_sha"`
	} `json:"diff_refs"`
	// DetailedMergeStatus is GitLab's machine-readable answer to "why can this
	// not be merged" (see ClassifyMerge). It is the only thing that separates an
	// MR that is not ready yet from one that never will be: the merge endpoint
	// refuses both with the same 422 "Branch cannot be merged".
	DetailedMergeStatus string `json:"detailed_merge_status"`
}

// MergeReadiness is what auto-merge should do about an open MR right now.
type MergeReadiness int

const (
	// MergeReady - GitLab will accept a merge.
	MergeReady MergeReadiness = iota
	// MergePending - GitLab is still computing mergeability; it clears on its
	// own, so the next poller tick retries.
	MergePending
	// MergeBlocked - something a machine cannot resolve (a conflict, a gate the
	// project requires). Retrying never helps; a person has to act.
	MergeBlocked
)

// ClassifyMerge maps GitLab's detailed_merge_status onto what auto-merge should
// do. Unknown values count as blocked: a state we do not recognise is one we
// cannot claim will clear, and reporting it is better than retrying forever.
// An empty status means the instance does not report one (it was added in
// GitLab 15.6) - fall back to attempting the merge, as the portal always did.
func ClassifyMerge(detailed string) MergeReadiness {
	switch detailed {
	case "", "mergeable":
		return MergeReady
	case "checking", "unchecked", "preparing":
		return MergePending
	default:
		return MergeBlocked
	}
}

// FileAction is one change in a commit (mirrors GitLab commit actions API).
type FileAction struct {
	Action   string `json:"action"` // create|update|delete
	FilePath string `json:"file_path"`
	Content  string `json:"content,omitempty"`
}

// DiscoveredApp is one application.yaml found under the GitOps group, with enough
// location info to read its sibling files and derive the order identity.
type DiscoveredApp struct {
	ProjectID     int
	ProjectPath   string // path_with_namespace, e.g. managed-services/team-core/postgres
	ProjectWebURL string // repo web URL (the git source baked into application.yaml)
	Branch        string // default branch the manifest lives on
	FilePath      string // application.yaml path within the repo, e.g. in-cluster/pg1/application.yaml
	Content       []byte // the application.yaml bytes
}

// Port is the provisioning layer's view of GitLab. Both the real HTTP client
// and the in-memory fake implement it.
type Port interface {
	// GetGroup resolves a (sub)group by full path; ErrNotFound if absent.
	// The portal never creates team subgroups - they are provisioned manually.
	GetGroup(ctx context.Context, fullPath string) (*Group, error)
	// GetProject resolves a repo by full path; ErrNotFound if absent.
	GetProject(ctx context.Context, fullPath string) (*Project, error)
	// CreateProject creates a repo inside a namespace (the team subgroup).
	CreateProject(ctx context.Context, namespaceID int, name string) (*Project, error)

	// CreateBranch creates a branch from ref on a project.
	CreateBranch(ctx context.Context, projectID int, branch, ref string) error
	// CommitFiles commits a set of file actions onto a branch.
	CommitFiles(ctx context.Context, projectID int, branch, message string, actions []FileAction) error
	// ListTree returns file paths under a directory on a branch (for delete).
	ListTree(ctx context.Context, projectID int, branch, path string) ([]string, error)
	// GetFile returns a file's verbatim content on a ref; ErrNotFound if absent.
	// Used by drift detection to read back committed values.yaml/application.yaml.
	GetFile(ctx context.Context, projectID int, path, ref string) ([]byte, error)
	// DiscoverApplications returns every application.yaml under the GitOps group
	// with its location (for import/discovery of orders created outside the portal).
	DiscoverApplications(ctx context.Context) ([]DiscoveredApp, error)
	// LastCommitAuthor returns the author (name, email) of the most recent commit
	// touching path on ref. Empty strings if unknown; used to attribute imported
	// orders to whoever created the manifest in Git.
	LastCommitAuthor(ctx context.Context, projectID int, path, ref string) (name, email string, err error)

	// CreateMR opens a merge request.
	CreateMR(ctx context.Context, projectID int, source, target, title string) (*MR, error)
	// GetMR returns the current MR state.
	GetMR(ctx context.Context, projectID, iid int) (*MR, error)
	// MergeMR merges an open MR. Used by the optional auto-merge in the poller;
	// a not-yet-mergeable MR returns an error and is retried on the next tick.
	MergeMR(ctx context.Context, projectID, iid int) error
	// CloseMR closes an open MR without merging it. Used when the portal
	// supersedes a change with a rewritten one, so the abandoned merge request
	// does not sit open next to it.
	CloseMR(ctx context.Context, projectID, iid int) error

	Healthz(ctx context.Context) error
}
