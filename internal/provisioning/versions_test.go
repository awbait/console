package provisioning_test

import (
	"context"
	"errors"
	"testing"

	"console/internal/provisioning"
	"console/pkg/models"
)

// seedVersionedPub registers a version-managed publication (no legacy approved
// view) with a single orderable+APPROVED version carrying the given view.
func seedVersionedPub(t *testing.T, s *stack, project, name, orderableVersion string, view []byte) {
	t.Helper()
	ctx := context.Background()
	_ = s.st.CreateCategory(ctx, &models.Category{ID: "db", Label: "db"})
	pub := &models.ChartPublication{
		ID: "pub-" + name, ChartProject: project, ChartName: name,
		CategoryID: "db", OwnerTeam: "core", CreatedBy: "seed", Status: models.PubApproved,
	}
	if err := s.st.CreatePublication(ctx, pub); err != nil {
		t.Fatalf("create pub: %v", err)
	}
	v := &models.PublicationVersion{
		ID: "ver-" + orderableVersion, PublicationID: pub.ID, ChartVersion: orderableVersion,
		ApprovedViewJSON: view, Status: models.PubApproved, Orderable: true,
	}
	if err := s.st.UpsertVersion(ctx, v); err != nil {
		t.Fatalf("upsert version: %v", err)
	}
}

// seedVersion adds another approved, orderable version to a chart's existing
// publication.
func seedVersion(t *testing.T, s *stack, name, chartVersion string, view []byte) {
	t.Helper()
	ctx := context.Background()
	pub, err := s.st.GetPublicationByChart(ctx, "platform", name)
	if err != nil {
		t.Fatalf("get pub %s: %v", name, err)
	}
	v := &models.PublicationVersion{
		ID: "ver-" + name + "-" + chartVersion, PublicationID: pub.ID, ChartVersion: chartVersion,
		ApprovedViewJSON: view, Status: models.PubApproved, Orderable: true,
	}
	if err := s.st.UpsertVersion(ctx, v); err != nil {
		t.Fatalf("upsert version %s: %v", chartVersion, err)
	}
}

func TestOrderGuardRejectsNonOrderableVersion(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")
	view := []byte(`{"views":{"order":{"identity":"/auth/database","include":["auth"]}}}`)
	// Only 15.4.2 is orderable; 15.4.1 exists in Harbor but is not allowlisted.
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", view)

	_, err := s.prov.Create(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.1",
		Team: "core", ServiceName: "pg1", Values: validValues(), Draft: true,
	})
	var ve *provisioning.ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("non-orderable version: want ValidationError, got %v", err)
	}
}

// A version taken out of the catalog - retired, or simply unpublished - stops
// new orders. It must not freeze the ones already running on it: their service
// is up, and changing its parameters is the one thing their owners still do.
func TestChangeValuesSurvivesTheVersionLeavingTheCatalog(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")
	view := []byte(`{"views":{"order":{"identity":"/auth/database","include":["auth"]}}}`)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.1", view)

	req, err := s.prov.Create(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.1",
		Team: "core", ServiceName: "pg1", Values: validValues(),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	s.mergeLatestMR(ctx, t, req.ID)
	s.tick(ctx)

	// The version the order runs leaves the catalog, and a newer one takes over.
	pub, err := s.st.GetPublicationByChart(ctx, "platform", "postgres")
	if err != nil {
		t.Fatal(err)
	}
	old, err := s.st.GetVersion(ctx, pub.ID, "15.4.1")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.st.SetOrderable(ctx, old.ID, false); err != nil {
		t.Fatal(err)
	}
	seedVersion(t, s, "postgres", "15.4.2", view)

	// Same version, new values: allowed. The allowlist decides what may be
	// chosen, and this order chooses nothing.
	values := validValues()
	values["auth"].(map[string]any)["database"] = "app2"
	if _, err := s.prov.Update(ctx, u, req.ID, provisioning.UpdateInput{Values: values}); err != nil {
		t.Fatalf("change values on a de-listed version: %v", err)
	}
	// That change rides in its own merge request; let it land before asking for
	// the next one, or the guard that answers is the open-MR one.
	s.mergeLatestMR(ctx, t, req.ID)
	s.tick(ctx)
	// Moving onto a version that is not on offer is still refused: that is a
	// choice, and the allowlist is what answers it.
	seedVersion(t, s, "postgres", "15.4.0", view)
	shelved, err := s.st.GetVersion(ctx, pub.ID, "15.4.0")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.st.SetOrderable(ctx, shelved.ID, false); err != nil {
		t.Fatal(err)
	}
	values["auth"].(map[string]any)["database"] = "app3"
	_, err = s.prov.Update(ctx, u, req.ID, provisioning.UpdateInput{Version: "15.4.0", Values: values})
	var ve *provisioning.ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("moving onto a de-listed version: want ValidationError, got %v", err)
	}
}

func TestOrderUsesSelectedVersionView(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")
	// The order view's identity pointer resolves against the order values.
	view := []byte(`{"views":{"order":{"identity":"/auth/database","include":["auth"]}}}`)
	seedVersionedPub(t, s, "platform", "postgres", "15.4.2", view)

	req, err := s.prov.Create(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "pg1", Values: validValues(), Draft: true,
	})
	if err != nil {
		t.Fatalf("create orderable version: %v", err)
	}
	// resourceIdentity must come from the selected version's view (auth.database).
	if req.ResourceIdentity != "app" {
		t.Fatalf("resource identity from version view: want \"app\", got %q", req.ResourceIdentity)
	}
}
