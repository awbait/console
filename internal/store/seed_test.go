package store

import (
	"testing"

	"console/internal/views"
)

// The seeded view documents must pass format validation - otherwise the builder
// would immediately show errors on the reference publications.
func TestSeedViewIsStructurallyValid(t *testing.T) {
	if issues := views.ValidateStructure(seedIngressView); len(issues) > 0 {
		t.Fatalf("ingress seed view has issues: %+v", issues)
	}
	if issues := views.ValidateStructure(seedNamespaceView); len(issues) > 0 {
		t.Fatalf("namespace seed view has issues: %+v", issues)
	}
}
