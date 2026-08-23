package webhooks

import "testing"

func TestDeliveriesCountWhatArrived(t *testing.T) {
	h, _ := newHandler()
	d := h.Deliveries()

	if got := d.Get("gitlab"); got.Total() != 0 {
		t.Fatalf("a fresh portal already counts %d deliveries", got.Total())
	}
	if d.Since().IsZero() {
		t.Fatal("the recorder does not know when it started counting")
	}

	// A merged merge request: taken and acted on.
	post(h.GitLab, "X-Gitlab-Token", "gl-secret",
		`{"object_kind":"merge_request","object_attributes":{"state":"merged"}}`)
	// An event the portal does not act on. The secret still matched, which for
	// "is this wired up" is the same good news.
	post(h.GitLab, "X-Gitlab-Token", "gl-secret", `{"object_kind":"push"}`)
	// The secrets have drifted apart. This is the only visible symptom there is.
	post(h.GitLab, "X-Gitlab-Token", "another-secret", `{"object_kind":"merge_request"}`)
	// A body that does not parse.
	post(h.GitLab, "X-Gitlab-Token", "gl-secret", `nonsense`)

	got := d.Get("gitlab")
	if got.Accepted != 1 || got.Ignored != 1 || got.Rejected != 1 || got.BadRequest != 1 {
		t.Fatalf("counted %+v", got)
	}
	if got.Total() != 4 {
		t.Fatalf("total = %d, want 4", got.Total())
	}
	if got.LastAccepted.IsZero() || got.LastRejected.IsZero() || got.LastAt.IsZero() {
		t.Fatalf("timestamps missing: %+v", got)
	}
	// Harbor is counted separately: one source being wired up says nothing about
	// the other.
	if other := d.Get("harbor"); other.Total() != 0 {
		t.Fatalf("harbor counted %d deliveries from GitLab traffic", other.Total())
	}
}

func TestDeliveriesHarborSourceIsSeparate(t *testing.T) {
	h, _ := newHandler()
	post(h.Harbor, "Authorization", "hb-secret", `{"type":"PUSH_ARTIFACT"}`)
	post(h.Harbor, "Authorization", "wrong", `{"type":"PUSH_ARTIFACT"}`)

	got := h.Deliveries().Get("harbor")
	if got.Accepted != 1 || got.Rejected != 1 {
		t.Fatalf("counted %+v", got)
	}
}

func TestDeliveriesOfAnUnknownSourceAreZero(t *testing.T) {
	d := newDeliveries()
	if got := d.Get("nobody"); got.Total() != 0 || !got.LastAt.IsZero() {
		t.Fatalf("got %+v, want the zero value", got)
	}
}
