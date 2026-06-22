package provisioning_test

import (
	"context"
	"errors"
	"testing"

	"console/internal/provisioning"
)

// TestCreateRejectsBadCluster: a Cluster that is not a valid Kubernetes name
// must be refused (M10), since it lands in Git commit paths and the rendered
// application.yaml destination.
func TestCreateRejectsBadCluster(t *testing.T) {
	ctx := context.Background()
	s := newStack(t)
	u := member("core")

	for _, bad := range []string{"../evil", "a/b", "Up", "with space"} {
		_, err := s.prov.Create(ctx, u, provisioning.CreateInput{
			ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
			Team: "core", ServiceName: "svc", Cluster: bad, Values: draft("app"), Draft: true,
		})
		var ve *provisioning.ValidationError
		if !errors.As(err, &ve) {
			t.Errorf("cluster %q: want ValidationError, got %v", bad, err)
		}
	}

	// A valid cluster name is accepted.
	if _, err := s.prov.Create(ctx, u, provisioning.CreateInput{
		ChartProject: "platform", ChartName: "postgres", Version: "15.4.2",
		Team: "core", ServiceName: "svc", Cluster: "in-cluster", Values: draft("app"), Draft: true,
	}); err != nil {
		t.Fatalf("valid cluster rejected: %v", err)
	}
}
