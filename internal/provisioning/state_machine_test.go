package provisioning

import (
	"testing"

	"console/pkg/models"
)

func TestCanTransition(t *testing.T) {
	ok := [][2]models.RequestStatus{
		{models.StatusDraft, models.StatusMRCreated},
		{models.StatusMRCreated, models.StatusMRMerged},
		{models.StatusMRMerged, models.StatusDeploying},
		{models.StatusDeploying, models.StatusHealthy},
		{models.StatusHealthy, models.StatusDeleteRequested},
		{models.StatusDeleteRequested, models.StatusDeleteMRMerged},
		{models.StatusDeleteMRMerged, models.StatusDeleted},
		{models.StatusHealthy, models.StatusHealthy}, // no-op allowed
		// delete is allowed once the create MR is merged
		{models.StatusMRMerged, models.StatusDeleteRequested},
		{models.StatusDeploying, models.StatusDeleteRequested},
		{models.StatusArgoMissing, models.StatusDeleteRequested},
		// edit (-> MR_CREATED) is allowed once the create MR is merged
		{models.StatusMRMerged, models.StatusMRCreated},
		{models.StatusDeploying, models.StatusMRCreated},
		{models.StatusDegraded, models.StatusMRCreated},
		// a deletion called off leaves the service running, so the order goes
		// back to being live instead of into a dead end
		{models.StatusDeleteRequested, models.StatusMRMerged},
	}
	for _, e := range ok {
		if !CanTransition(e[0], e[1]) {
			t.Errorf("expected %s -> %s allowed", e[0], e[1])
		}
	}

	bad := [][2]models.RequestStatus{
		{models.StatusDraft, models.StatusHealthy},
		{models.StatusMRMerged, models.StatusHealthy},
		{models.StatusDeleted, models.StatusHealthy},
		// delete forbidden until the create MR is merged
		{models.StatusMRCreated, models.StatusDeleteRequested},
		{models.StatusDraft, models.StatusDeleteRequested},
		// MR_CLOSED means the first order was turned down and no service was
		// created. Nothing else ends there, and nothing leaves it.
		{models.StatusDeleteRequested, models.StatusMRClosed},
		{models.StatusMRClosed, models.StatusMRCreated},
		{models.StatusMRClosed, models.StatusDeleteRequested},
	}
	for _, e := range bad {
		if CanTransition(e[0], e[1]) {
			t.Errorf("expected %s -> %s rejected", e[0], e[1])
		}
	}
}
