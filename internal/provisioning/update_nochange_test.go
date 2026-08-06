package provisioning_test

import (
	"context"
	"errors"
	"testing"

	"console/internal/provisioning"
	"console/pkg/models"
)

// Saving an order without touching anything must not open a merge request. An
// empty diff is not harmless: the order moves to MR_CREATED waiting on a review
// of nothing, and every real edit is refused until someone closes it.
func TestUpdateWithoutChanges(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	req := healthyOrder(ctx, t, s)
	u := member("core")

	before, _ := s.st.ListMRs(ctx, req.ID)

	_, err := s.prov.Update(ctx, u, req.ID, provisioning.UpdateInput{Values: validValues()})
	var ve *provisioning.ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("want ValidationError for an unchanged update, got %v", err)
	}

	after, _ := s.st.ListMRs(ctx, req.ID)
	if len(after) != len(before) {
		t.Fatalf("expected no new MR, had %d now %d", len(before), len(after))
	}
	if got := mustStatus(ctx, t, s.st, req.ID); got != models.StatusHealthy {
		t.Fatalf("order should not have moved, want HEALTHY, got %s", got)
	}
}

// The same values written differently are the same values: they marshal to the
// YAML already in Git, so there is still nothing to merge.
func TestUpdateWithReorderedValues(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	req := healthyOrder(ctx, t, s)
	u := member("core")

	_, err := s.prov.Update(ctx, u, req.ID, provisioning.UpdateInput{
		Values: map[string]any{"auth": map[string]any{"database": "app"}},
	})
	var ve *provisioning.ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("want ValidationError, got %v", err)
	}
}

// A real edit still goes through and opens its merge request.
func TestUpdateWithChanges(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	req := healthyOrder(ctx, t, s)
	u := member("core")

	before, _ := s.st.ListMRs(ctx, req.ID)

	out, err := s.prov.Update(ctx, u, req.ID, provisioning.UpdateInput{
		Values: map[string]any{"auth": map[string]any{"database": "edited"}},
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if out.Status != models.StatusMRCreated {
		t.Fatalf("want MR_CREATED, got %s", out.Status)
	}
	after, _ := s.st.ListMRs(ctx, req.ID)
	if len(after) != len(before)+1 {
		t.Fatalf("expected one new MR, had %d now %d", len(before), len(after))
	}
}
