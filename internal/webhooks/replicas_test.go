package webhooks

import "testing"

// A delivery reaches whichever replica the ingress picked, and the counters it
// feeds are read on whichever replica an admin opened: the configuration page,
// and the button that asks GitLab for a test delivery and then waits for it to
// arrive. So a delivery is counted where it lands and announced to the rest.

// TestADeliveryIsAnnouncedOnce: one announcement per delivery, carrying what it
// was, whatever the handler decided to do with it.
func TestADeliveryIsAnnouncedOnce(t *testing.T) {
	h, _ := newHandler()
	type said struct{ source, outcome string }
	var heard []said
	h.Announce = func(source, outcome string) { heard = append(heard, said{source, outcome}) }

	body := `{"object_kind":"merge_request","project":{"id":7},"object_attributes":{"iid":3,"action":"merge","state":"merged"}}`
	post(h.GitLab, "X-Gitlab-Token", "gl-secret", body)
	post(h.GitLab, "X-Gitlab-Token", "wrong", body)

	want := []said{{"gitlab", OutcomeAccepted}, {"gitlab", OutcomeRejected}}
	if len(heard) != len(want) {
		t.Fatalf("announced %v, want one per delivery: %v", heard, want)
	}
	for i := range want {
		if heard[i] != want[i] {
			t.Fatalf("announcement %d is %v, want %v", i, heard[i], want[i])
		}
	}
}

// TestADeliveryElsewhereCounts: the counters describe the portal, not the
// process, so an admin on a standby replica sees that deliveries arrive.
func TestADeliveryElsewhereCounts(t *testing.T) {
	h, _ := newHandler()
	if got := h.Deliveries().Get("gitlab").Total(); got != 0 {
		t.Fatalf("a fresh handler counts %d deliveries, want 0", got)
	}

	h.RecordElsewhere("gitlab", OutcomeAccepted)

	got := h.Deliveries().Get("gitlab")
	if got.Accepted != 1 || got.LastAccepted.IsZero() {
		t.Fatalf("counters are %+v, want the delivery that reached another replica", got)
	}
}

// TestAHandlerWithNobodyToTellStillCounts: one replica has no announcer, and
// nothing about the counting changes.
func TestAHandlerWithNobodyToTellStillCounts(t *testing.T) {
	h, _ := newHandler()
	body := `{"object_kind":"merge_request","project":{"id":7},"object_attributes":{"iid":3,"action":"merge","state":"merged"}}`
	post(h.GitLab, "X-Gitlab-Token", "gl-secret", body)

	if got := h.Deliveries().Get("gitlab").Accepted; got != 1 {
		t.Fatalf("accepted deliveries = %d, want 1", got)
	}
}
