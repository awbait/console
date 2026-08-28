package provisioning_test

import (
	"context"
	"slices"
	"strings"
	"testing"

	"console/pkg/models"
)

// branchesOf lists the branches the order's repository has right now.
func branchesOf(ctx context.Context, t *testing.T, s *stack) []string {
	t.Helper()
	proj, err := s.gl.GetProject(ctx, "managed-services/team-core/postgres")
	if err != nil {
		t.Fatalf("get project: %v", err)
	}
	return s.gl.Branches(proj.ID)
}

func portalBranches(ctx context.Context, t *testing.T, s *stack) []string {
	t.Helper()
	var out []string
	for _, b := range branchesOf(ctx, t, s) {
		if strings.HasPrefix(b, "portal/") {
			out = append(out, b)
		}
	}
	return out
}

// Every change the portal makes rides on a branch of its own. Once the change
// has landed the branch has no reader left, and a repository that collects one
// per edit of every service becomes unusable to the people who work in it.
func TestMergedChangesLeaveNoBranchesBehind(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")

	r := liveOrder(ctx, t, s) // create, merged

	openUpdateMR(ctx, t, s, r, map[string]any{"auth": map[string]any{"database": "mine"}})
	s.mergeLatestMR(ctx, t, r.ID)
	s.tick(ctx)

	if _, err := s.prov.Delete(ctx, u, r.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	s.mergeLatestMR(ctx, t, r.ID)
	s.tick(ctx)

	if left := portalBranches(ctx, t, s); len(left) != 0 {
		t.Errorf("merged changes left their branches behind: %v", left)
	}
	if got := branchesOf(ctx, t, s); !slices.Equal(got, []string{"main"}) {
		t.Errorf("branches = %v, want main alone", got)
	}
}

// A change the portal rewrites onto a moved branch is one it closed itself:
// everything that was on the old branch has just been carried into the new one,
// so the old branch goes with the merge request it belonged to.
func TestSupersededChangeTakesItsBranchWithIt(t *testing.T) {
	ctx := context.Background()
	s := newAutoMergeStack(t)
	r := liveOrder(ctx, t, s)

	mr := openUpdateMR(ctx, t, s, r, map[string]any{
		"auth": map[string]any{"database": "mine"},
	})
	live, err := s.gl.GetMR(ctx, mr.GitLabProjectID, mr.MRIID)
	if err != nil {
		t.Fatalf("get mr: %v", err)
	}
	stale := live.SourceBranch

	editOnBranch(ctx, t, s, r, "auth:\n  database: app\n  username: theirs\n")
	if err := s.gl.SetDetailedMergeStatus(mr.GitLabProjectID, mr.MRIID, "conflict"); err != nil {
		t.Fatalf("set merge status: %v", err)
	}
	s.tick(ctx)

	if slices.Contains(branchesOf(ctx, t, s), stale) {
		t.Errorf("branch %q of the superseded change is still there", stale)
	}
	// The rewritten change is still open, and its own branch has to be intact.
	mrs, err := s.st.ListMRs(ctx, r.ID)
	if err != nil || len(mrs) < 3 {
		t.Fatalf("list mrs: %v (%d)", err, len(mrs))
	}
	reopened, err := s.gl.GetMR(ctx, mrs[2].GitLabProjectID, mrs[2].MRIID)
	if err != nil {
		t.Fatalf("get reopened mr: %v", err)
	}
	if !slices.Contains(branchesOf(ctx, t, s), reopened.SourceBranch) {
		t.Errorf("the reopened change lost its branch %q", reopened.SourceBranch)
	}
}

// A change somebody turned down keeps its branch. Whatever they objected to is
// written there, and the portal is not the one to decide it can go.
func TestChangeTurnedDownKeepsItsBranch(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	r := liveOrder(ctx, t, s)

	mr := openUpdateMR(ctx, t, s, r, map[string]any{
		"auth": map[string]any{"database": "mine"},
	})
	live, err := s.gl.GetMR(ctx, mr.GitLabProjectID, mr.MRIID)
	if err != nil {
		t.Fatalf("get mr: %v", err)
	}
	closeLatestMR(ctx, t, s, r.ID)
	for range 3 {
		s.tick(ctx)
	}

	if !slices.Contains(branchesOf(ctx, t, s), live.SourceBranch) {
		t.Errorf("branch %q of a change a person closed was deleted", live.SourceBranch)
	}
	if got := mustStatus(ctx, t, s.st, r.ID); got != models.StatusHealthy {
		t.Fatalf("order = %s, want it back to HEALTHY", got)
	}
}
