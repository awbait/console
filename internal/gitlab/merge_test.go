package gitlab_test

import (
	"context"
	"io"
	"net/http"
	"testing"

	"console/internal/gitlab"
)

// The merge endpoint refuses "not ready yet" and "never going to work" with the
// same 422, so this classification is the only thing that keeps the poller from
// retrying a conflicted merge request until someone notices.
func TestClassifyMerge(t *testing.T) {
	cases := []struct {
		detailed string
		want     gitlab.MergeReadiness
	}{
		{"mergeable", gitlab.MergeReady},
		{"", gitlab.MergeReady}, // instance reports no status: try it, as before
		{"checking", gitlab.MergePending},
		{"unchecked", gitlab.MergePending},
		{"preparing", gitlab.MergePending},
		{"approvals_syncing", gitlab.MergePending},
		{"ci_still_running", gitlab.MergePending},
		{"conflict", gitlab.MergeBlocked},
		{"need_rebase", gitlab.MergeBlocked},
		{"ci_must_pass", gitlab.MergeBlocked},
		{"not_approved", gitlab.MergeBlocked},
		{"discussions_not_resolved", gitlab.MergeBlocked},
		{"draft_status", gitlab.MergeBlocked},
		// A state this build has never heard of is one it cannot call a failure.
		// The portal does not attempt the merge either way, and a change that
		// never leaves the state is reported on time rather than on sight.
		{"something_gitlab_added_later", gitlab.MergePending},
	}
	for _, c := range cases {
		if got := gitlab.ClassifyMerge(c.detailed); got != c.want {
			t.Errorf("ClassifyMerge(%q) = %v, want %v", c.detailed, got, c.want)
		}
	}
}

// The status is read straight off the merge request, so a typo in the JSON tag
// would silently make every MR look mergeable.
func TestGetMRReadsDetailedMergeStatus(t *testing.T) {
	c, srv := newServer(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w,
			`{"iid":7,"project_id":3,"state":"opened","detailed_merge_status":"conflict"}`)
	})
	defer srv.Close()

	mr, err := c.GetMR(context.Background(), 3, 7)
	if err != nil {
		t.Fatalf("GetMR: %v", err)
	}
	if mr.DetailedMergeStatus != "conflict" {
		t.Errorf("DetailedMergeStatus = %q, want %q", mr.DetailedMergeStatus, "conflict")
	}
}
