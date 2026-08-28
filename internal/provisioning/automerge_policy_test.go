package provisioning_test

import (
	"context"
	"strings"
	"testing"

	"console/internal/provisioning"
	"console/pkg/models"
)

// reviewedChart is a version that says every change to it has to be read by a
// person, the way a network-policy service does.
const reviewedChart = `{"views":{"order":{"identity":"/auth/database"}},"approval":{"autoMerge":false}}`

// A service that requires review is not merged by the portal, even where the
// installation lets it merge its own changes.
func TestServiceRequiringReviewIsNotAutoMerged(t *testing.T) {
	ctx := context.Background()
	s := newAutoMergeStack(t)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", []byte(reviewedChart))
	req, _ := orderWithOpenMR(ctx, t, s)

	for range 3 {
		s.tick(ctx)
	}

	if got := mrStatus(ctx, t, s, req.ID); got != models.MROpened {
		t.Fatalf("MR status = %q, want %q: the change waits for a person", got, models.MROpened)
	}
	after, err := s.st.GetRequest(ctx, req.ID)
	if err != nil {
		t.Fatalf("get order: %v", err)
	}
	if after.Status != models.StatusMRCreated {
		t.Fatalf("order status = %s, want it to wait in MR_CREATED", after.Status)
	}
	// Waiting for a review is not a blocked merge: nothing is wrong, so nothing
	// is reported as wrong.
	if evs := countEvents(ctx, t, s, req.ID, "merge_blocked"); len(evs) != 0 {
		t.Fatalf("merge_blocked events = %d, want none: the change is not stuck", len(evs))
	}
}

// The same version, merged by a person: the order carries on exactly as one the
// portal merged itself.
func TestServiceRequiringReviewProceedsOnceMerged(t *testing.T) {
	ctx := context.Background()
	s := newAutoMergeStack(t)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", []byte(reviewedChart))
	req, _ := orderWithOpenMR(ctx, t, s)

	s.tick(ctx)
	s.mergeLatestMR(ctx, t, req.ID) // the reviewer presses the button
	s.tick(ctx)
	s.tick(ctx)

	after, err := s.st.GetRequest(ctx, req.ID)
	if err != nil {
		t.Fatalf("get order: %v", err)
	}
	if after.Status != models.StatusHealthy {
		t.Fatalf("order status = %s, want HEALTHY", after.Status)
	}
}

// The point of keeping the two apart: a service that waits for a person still
// gets its change rewritten when the branch moves. Otherwise the reviewer would
// be handed a conflict they cannot resolve from the portal at all.
func TestReviewedServiceStillGetsItsChangeRewritten(t *testing.T) {
	ctx := context.Background()
	s := newAutoMergeStack(t)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", []byte(reviewedChart))

	req, _ := orderWithOpenMR(ctx, t, s)
	s.mergeLatestMR(ctx, t, req.ID) // the create MR, merged by a person
	s.tick(ctx)
	live, err := s.st.GetRequest(ctx, req.ID)
	if err != nil {
		t.Fatalf("get order: %v", err)
	}

	mr := openUpdateMR(ctx, t, s, live, map[string]any{
		"auth": map[string]any{"database": "mine"},
	})
	editOnBranch(ctx, t, s, live, "auth:\n  database: app\n  username: theirs\n")
	if err := s.gl.SetDetailedMergeStatus(mr.GitLabProjectID, mr.MRIID, "conflict"); err != nil {
		t.Fatalf("set merge status: %v", err)
	}

	s.tick(ctx)

	mrs, err := s.st.ListMRs(ctx, req.ID)
	if err != nil {
		t.Fatalf("list mrs: %v", err)
	}
	if len(mrs) != 3 {
		t.Fatalf("want the change rewritten (3 merge requests), got %d", len(mrs))
	}
	reopened := mrs[2]
	if reopened.Status != models.MROpened {
		t.Fatalf("rewritten MR is %s, want it left open for the reviewer", reopened.Status)
	}
	glMR, err := s.gl.GetMR(ctx, reopened.GitLabProjectID, reopened.MRIID)
	if err != nil {
		t.Fatalf("get reopened mr: %v", err)
	}
	got := valuesOnRef(ctx, t, s, live, glMR.SourceBranch)
	if !strings.Contains(got, "database: mine") || !strings.Contains(got, "username: theirs") {
		t.Fatalf("rewritten change lost one of the edits:\n%s", got)
	}
}

// A version that says nothing about merging follows the installation, which is
// how every chart behaved before the rule existed.
func TestSilentVersionFollowsTheInstallation(t *testing.T) {
	ctx := context.Background()
	s := newAutoMergeStack(t)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2",
		[]byte(`{"views":{"order":{"identity":"/auth/database"}}}`))
	req, _ := orderWithOpenMR(ctx, t, s)

	s.tick(ctx)

	if got := mrStatus(ctx, t, s, req.ID); got != models.MRMerged {
		t.Fatalf("MR status = %q, want %q", got, models.MRMerged)
	}
}

// The order page asks the same question the poller merges by, and it has to get
// the same answer: a page promising that somebody will read the change, where
// the portal is about to merge it unread, is the wording this exists to stop.
func TestOrderReviewFollowsTheSameRuleAsTheMerge(t *testing.T) {
	ctx := context.Background()

	t.Run("nobody waits where the portal merges its own changes", func(t *testing.T) {
		s := newAutoMergeStack(t)
		seedVersionedPub(t, s, "platform", "postgres", "15.4.2",
			[]byte(`{"views":{"order":{"identity":"/auth/database"}}}`))
		req, _ := orderWithOpenMR(ctx, t, s)

		if rev := s.prov.OrderReview(ctx, req); rev.Required {
			t.Fatalf("review = %+v, want none: this change merges without a person", rev)
		}
		s.tick(ctx)
		if got := mrStatus(ctx, t, s, req.ID); got != models.MRMerged {
			t.Fatalf("MR status = %q, want %q: the page said nobody was waiting", got, models.MRMerged)
		}
	})

	t.Run("the service asks for a person", func(t *testing.T) {
		s := newAutoMergeStack(t)
		seedVersionedPub(t, s, "platform", "postgres", "15.4.2", []byte(reviewedChart))
		req, _ := orderWithOpenMR(ctx, t, s)

		rev := s.prov.OrderReview(ctx, req)
		if !rev.Required || rev.By != provisioning.ReviewByService {
			t.Fatalf("review = %+v, want the service asking for it", rev)
		}
		s.tick(ctx)
		if got := mrStatus(ctx, t, s, req.ID); got != models.MROpened {
			t.Fatalf("MR status = %q, want %q: the change waits for the person the page named", got, models.MROpened)
		}
	})

	t.Run("the installation asks for a person, whatever the service says", func(t *testing.T) {
		s := newManualMergeStack(t)
		// A version that would happily be merged unattended: the installation
		// still refuses, and that is what the order has to say.
		seedVersionedPub(t, s, "platform", "postgres", "15.4.2",
			[]byte(`{"views":{"order":{"identity":"/auth/database"}},"approval":{"autoMerge":true}}`))
		req, _ := orderWithOpenMR(ctx, t, s)

		rev := s.prov.OrderReview(ctx, req)
		if !rev.Required || rev.By != provisioning.ReviewByInstallation {
			t.Fatalf("review = %+v, want the installation asking for it", rev)
		}
		s.tick(ctx)
		if got := mrStatus(ctx, t, s, req.ID); got != models.MROpened {
			t.Fatalf("MR status = %q, want %q", got, models.MROpened)
		}
	})
}
