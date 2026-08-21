package provisioning_test

import (
	"context"
	"strings"
	"testing"

	"console/internal/gitlab"
	"console/internal/provisioning"
	"console/pkg/models"
)

// liveOrder creates an order and merges its create MR, leaving it deployed and
// editable - the state an update starts from.
func liveOrder(ctx context.Context, t *testing.T, s *stack) *models.Request {
	t.Helper()
	req, _ := orderWithOpenMR(ctx, t, s)
	s.mergeLatestMR(ctx, t, req.ID)
	s.tick(ctx)
	live, err := s.st.GetRequest(ctx, req.ID)
	if err != nil {
		t.Fatalf("get order: %v", err)
	}
	return live
}

// editOnBranch commits someone else's change to the order's values.yaml
// straight onto the default branch, the way a sibling order's merged MR or a
// person with repository access would.
func editOnBranch(ctx context.Context, t *testing.T, s *stack, r *models.Request, valuesYAML string) {
	t.Helper()
	proj, err := s.gl.GetProject(ctx, "managed-services/team-core/postgres")
	if err != nil {
		t.Fatalf("get project: %v", err)
	}
	err = s.gl.CommitFiles(ctx, proj.ID, "main", "chore: edit outside the portal", []gitlab.FileAction{
		{Action: "update", FilePath: s.gitops.ValuesPath(r), Content: valuesYAML},
	})
	if err != nil {
		t.Fatalf("commit on main: %v", err)
	}
}

// openUpdateMR edits the order through the portal, which opens the update MR.
func openUpdateMR(ctx context.Context, t *testing.T, s *stack, r *models.Request, values map[string]any) *models.RequestMR {
	t.Helper()
	if _, err := s.prov.Update(ctx, member("core"), r.ID, provisioning.UpdateInput{Values: values}); err != nil {
		t.Fatalf("update: %v", err)
	}
	mrs, err := s.st.ListMRs(ctx, r.ID)
	if err != nil || len(mrs) == 0 {
		t.Fatalf("no MRs for %s: %v", r.ID, err)
	}
	return mrs[len(mrs)-1]
}

func valuesOnRef(ctx context.Context, t *testing.T, s *stack, r *models.Request, ref string) string {
	t.Helper()
	proj, err := s.gl.GetProject(ctx, "managed-services/team-core/postgres")
	if err != nil {
		t.Fatalf("get project: %v", err)
	}
	b, err := s.gl.GetFile(ctx, proj.ID, s.gitops.ValuesPath(r), ref)
	if err != nil {
		t.Fatalf("read values at %s: %v", ref, err)
	}
	return string(b)
}

// The case the portal used to wedge on: an order is edited, someone else's
// change lands on the branch first, and Git refuses the merge on the text even
// though the two edits are to different fields. The portal merges them itself
// and reopens the change, keeping both.
func TestConflictedMRIsRewrittenOntoTheBranch(t *testing.T) {
	ctx := context.Background()
	s := newAutoMergeStack(t)
	r := liveOrder(ctx, t, s)

	// This order's edit: a new database name.
	mr := openUpdateMR(ctx, t, s, r, map[string]any{
		"auth": map[string]any{"database": "mine"},
	})
	// Someone else's, landing on the branch first and touching another field.
	editOnBranch(ctx, t, s, r, "auth:\n  database: app\n  username: theirs\n")
	if err := s.gl.SetDetailedMergeStatus(mr.GitLabProjectID, mr.MRIID, "conflict"); err != nil {
		t.Fatalf("set merge status: %v", err)
	}

	s.tick(ctx)

	mrs, err := s.st.ListMRs(ctx, r.ID)
	if err != nil {
		t.Fatalf("list mrs: %v", err)
	}
	if len(mrs) != 3 { // create, the conflicted update, and the rewritten one
		t.Fatalf("want 3 merge requests, got %d", len(mrs))
	}
	superseded, reopened := mrs[1], mrs[2]
	if superseded.Status != models.MRClosed {
		t.Errorf("superseded MR left %s, want closed", superseded.Status)
	}
	if reopened.Status != models.MROpened {
		t.Errorf("reopened MR is %s, want opened", reopened.Status)
	}

	// Both edits are in the reopened change.
	glMR, err := s.gl.GetMR(ctx, reopened.GitLabProjectID, reopened.MRIID)
	if err != nil {
		t.Fatalf("get reopened mr: %v", err)
	}
	got := valuesOnRef(ctx, t, s, r, glMR.SourceBranch)
	if !strings.Contains(got, "database: mine") {
		t.Errorf("this order's edit lost:\n%s", got)
	}
	if !strings.Contains(got, "username: theirs") {
		t.Errorf("the other change lost:\n%s", got)
	}

	if evs := countEvents(ctx, t, s, r.ID, "merge_retried"); len(evs) != 1 {
		t.Fatalf("want one merge_retried event, got %d", len(evs))
	}
	// The order's own record follows what was proposed, so the page and the
	// change do not disagree.
	after, err := s.st.GetRequest(ctx, r.ID)
	if err != nil {
		t.Fatalf("get order: %v", err)
	}
	if !strings.Contains(after.ValuesYAML, "username: theirs") ||
		!strings.Contains(after.ValuesYAML, "database: mine") {
		t.Errorf("order record does not match the reopened change:\n%s", after.ValuesYAML)
	}
	if after.Status != models.StatusMRCreated {
		t.Errorf("status = %s, want it to stay MR_CREATED", after.Status)
	}
}

// When both changes moved the same field there is nothing to merge silently:
// the portal names the field and leaves the change alone.
func TestConflictedMROnTheSameFieldIsReported(t *testing.T) {
	ctx := context.Background()
	s := newAutoMergeStack(t)
	r := liveOrder(ctx, t, s)

	mr := openUpdateMR(ctx, t, s, r, map[string]any{
		"auth": map[string]any{"database": "mine"},
	})
	editOnBranch(ctx, t, s, r, "auth:\n  database: theirs\n")
	if err := s.gl.SetDetailedMergeStatus(mr.GitLabProjectID, mr.MRIID, "conflict"); err != nil {
		t.Fatalf("set merge status: %v", err)
	}

	s.tick(ctx)

	mrs, err := s.st.ListMRs(ctx, r.ID)
	if err != nil {
		t.Fatalf("list mrs: %v", err)
	}
	if len(mrs) != 2 {
		t.Fatalf("want the change left as it was (2 merge requests), got %d", len(mrs))
	}
	if mrs[1].Status != models.MROpened {
		t.Errorf("conflicted MR is %s, want it left open", mrs[1].Status)
	}
	blocked := countEvents(ctx, t, s, r.ID, "merge_blocked")
	if len(blocked) != 1 {
		t.Fatalf("want one merge_blocked event, got %d", len(blocked))
	}
	if fields, _ := blocked[0].Payload["fields"].(string); !strings.Contains(fields, "auth.database") {
		t.Errorf("blocked event names %q, want the conflicting field", fields)
	}
}

// The poller comes back every few seconds: a disagreement must be announced
// once, and the change must not be rewritten again and again.
func TestConflictedMRIsNotRetriedForever(t *testing.T) {
	ctx := context.Background()
	s := newAutoMergeStack(t)
	r := liveOrder(ctx, t, s)

	mr := openUpdateMR(ctx, t, s, r, map[string]any{
		"auth": map[string]any{"database": "mine"},
	})
	editOnBranch(ctx, t, s, r, "auth:\n  database: theirs\n")
	if err := s.gl.SetDetailedMergeStatus(mr.GitLabProjectID, mr.MRIID, "conflict"); err != nil {
		t.Fatalf("set merge status: %v", err)
	}

	for range 8 {
		s.tick(ctx)
	}

	if evs := countEvents(ctx, t, s, r.ID, "merge_blocked"); len(evs) > 2 {
		t.Fatalf("blocked reported %d times, want it said once (twice at most)", len(evs))
	}
	mrs, err := s.st.ListMRs(ctx, r.ID)
	if err != nil {
		t.Fatalf("list mrs: %v", err)
	}
	if len(mrs) != 2 {
		t.Fatalf("want 2 merge requests after repeated ticks, got %d", len(mrs))
	}
}

// The bound is on chasing one moving branch, not on how often an order may ever
// be edited: once a change of its own merges, the count starts over.
func TestRewritesAreCountedPerChangeNotPerOrder(t *testing.T) {
	ctx := context.Background()
	s := newAutoMergeStack(t)
	r := liveOrder(ctx, t, s)

	// More editing rounds than the bound allows, each one merging before the next.
	// This order only ever renames the database, the other side only ever renames
	// the user, so every round is a clean merge rather than a disagreement. The
	// form submits the whole tree, as the real one does - including the user name
	// it was showing.
	database, user := "app", ""
	for i, next := range []string{"one", "two", "three", "four"} {
		live, err := s.st.GetRequest(ctx, r.ID)
		if err != nil {
			t.Fatalf("round %d: get order: %v", i, err)
		}
		mine := map[string]any{"database": next}
		if user != "" {
			mine["username"] = user
		}
		mr := openUpdateMR(ctx, t, s, live, map[string]any{"auth": mine})
		user = "user" + next
		editOnBranch(ctx, t, s, live, "auth:\n  database: "+database+"\n  username: "+user+"\n")
		database = next
		if err := s.gl.SetDetailedMergeStatus(mr.GitLabProjectID, mr.MRIID, "conflict"); err != nil {
			t.Fatalf("round %d: set merge status: %v", i, err)
		}
		s.tick(ctx) // rewrites the change onto the branch
		s.tick(ctx) // merges the rewritten one
		s.tick(ctx) // advances the order past the merge

		after, err := s.st.GetRequest(ctx, r.ID)
		if err != nil {
			t.Fatalf("round %d: get order: %v", i, err)
		}
		if !strings.Contains(after.ValuesYAML, "database: "+next) {
			t.Fatalf("round %d: edit lost, order holds:\n%s", i, after.ValuesYAML)
		}
	}
	if got := countEvents(ctx, t, s, r.ID, "merge_retried"); len(got) != 4 {
		t.Fatalf("merge_retried events = %d, want 4: every round has to be rewritten", len(got))
	}
}

// A change the chart itself would refuse must not be committed: the two edits
// merge cleanly on paper and produce values that do not validate.
func TestMergedValuesMustStillValidate(t *testing.T) {
	ctx := context.Background()
	s := newAutoMergeStack(t)
	r := liveOrder(ctx, t, s)

	mr := openUpdateMR(ctx, t, s, r, map[string]any{
		"auth": map[string]any{"database": "mine"},
	})
	// The other change drops the field the schema requires, in a way that only
	// shows once the two are combined.
	editOnBranch(ctx, t, s, r, "auth:\n  username: theirs\n")
	if err := s.gl.SetDetailedMergeStatus(mr.GitLabProjectID, mr.MRIID, "conflict"); err != nil {
		t.Fatalf("set merge status: %v", err)
	}

	s.tick(ctx)

	mrs, err := s.st.ListMRs(ctx, r.ID)
	if err != nil {
		t.Fatalf("list mrs: %v", err)
	}
	if len(mrs) != 2 {
		t.Fatalf("want the change left as it was (2 merge requests), got %d", len(mrs))
	}
	if got := countEvents(ctx, t, s, r.ID, "merge_retried"); len(got) != 0 {
		t.Fatalf("want no rewrite, got %d", len(got))
	}
}
