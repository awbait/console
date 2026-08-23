package checks

import (
	"context"
	"strconv"
	"time"

	"console/internal/config"
	"console/internal/gitlab"
)

// The one check the portal never runs by itself.
//
// Everything else here reads. This asks GitLab to send the portal a sample
// delivery, and it is the only way to learn the thing neither side will show:
// whether the two secrets are the same string. GitLab does not return the token
// it stores, the portal must not print the one it holds, and a mismatch produces
// no error anywhere until a real merge request is merged and nothing happens.
//
// Because it makes a real outbound delivery, it runs on a button press and
// nowhere else - not on a schedule, not on a page load.

// Outcomes of a delivery test. Turned into sentences by
// web/src/app/configChecks.ts, like every other identifier in this package.
const (
	// DeliveryDelivered - GitLab sent it, the portal received it, and the secret
	// matched. This is the whole answer: network, address and secret, all three.
	DeliveryDelivered = "delivered"
	// DeliveryRejected - it arrived and the portal refused it. The two sides
	// hold different secrets; nothing else produces this.
	DeliveryRejected = "rejected"
	// DeliveryNotDelivered - nothing arrived in time. GitLab cannot reach the
	// address it was given, or the address is not this portal.
	DeliveryNotDelivered = "not_delivered"
	// DeliveryNotConfigured - there is no webhook to test.
	DeliveryNotConfigured = "not_configured"
	// DeliveryNotRegistered - the portal never managed to register one.
	DeliveryNotRegistered = "not_registered"
	// DeliveryFailed - GitLab refused to send the test at all.
	DeliveryFailed = "failed"
)

// deliveryWait is how long the portal waits for the delivery to come back. A
// webhook that takes longer than this is not one anybody should rely on to
// advance an order, and a person is standing in front of the button.
const deliveryWait = 10 * time.Second

// deliveryPoll is how often the counters are re-read while waiting.
const deliveryPoll = 250 * time.Millisecond

// DeliveryTest is what the button produced.
type DeliveryTest struct {
	Outcome string            `json:"outcome"`
	Facts   map[string]string `json:"facts,omitempty"`
	// Detail is the upstream's own words when it refused to send the test.
	// Platform admins only, like every other raw upstream error on this page.
	Detail string `json:"detail,omitempty"`
}

// TestGitLabDelivery asks GitLab to deliver a sample merge-request event to the
// portal's own webhook and reports whether it arrived.
//
// It counts deliveries rather than intercepting one: the handler already records
// every arrival and every rejection (internal/webhooks.Deliveries), so a test
// delivery is simply a rise in those counters. That also means a real delivery
// landing during the wait is indistinguishable from the test one - which for the
// question being asked ("does delivery work") is the same good news.
func TestGitLabDelivery(ctx context.Context, cfg *config.Config, api GitLabAPI, hooks HookScoper, d Deliveries) DeliveryTest {
	if cfg.GitLabWebhookURL == "" || cfg.GitLabWebhookToken == "" {
		return DeliveryTest{Outcome: DeliveryNotConfigured}
	}
	if api == nil || hooks == nil || d == nil {
		return DeliveryTest{Outcome: DeliveryFailed}
	}
	scope := hooks.Scope()
	if scope == gitlab.HookScopeNone || scope == "" {
		return DeliveryTest{Outcome: DeliveryNotRegistered}
	}
	projectID, hookID, err := findTestableHook(ctx, cfg, api, scope)
	if err != nil {
		return DeliveryTest{Outcome: DeliveryFailed, Detail: err.Error(), Facts: factsOf("scope", string(scope))}
	}
	if hookID == 0 {
		return DeliveryTest{Outcome: DeliveryNotRegistered, Facts: factsOf("scope", string(scope))}
	}

	f := factsOf("scope", string(scope), "hook_id", strconv.Itoa(hookID))
	if projectID != 0 {
		f["project_id"] = strconv.Itoa(projectID)
	}
	before := d.Get("gitlab")
	if err := api.TestHook(ctx, scope, projectID, hookID); err != nil {
		// GitLab builds the sample payload from a real merge request, so a
		// repository that has never had one refuses here. That is a limit of the
		// test, not a broken webhook.
		return DeliveryTest{Outcome: DeliveryFailed, Detail: err.Error(), Facts: f}
	}
	return waitForDelivery(ctx, d, before, f)
}

// waitForDelivery watches the counters until one moves or the wait runs out.
func waitForDelivery(ctx context.Context, d Deliveries, before DeliveryCounts, f map[string]string) DeliveryTest {
	start := time.Now()
	t := time.NewTicker(deliveryPoll)
	defer t.Stop()
	for {
		now := d.Get("gitlab")
		f["waited_ms"] = strconv.FormatInt(time.Since(start).Milliseconds(), 10)
		switch {
		case now.Rejected > before.Rejected:
			f["rejected"] = strconv.Itoa(now.Rejected - before.Rejected)
			return DeliveryTest{Outcome: DeliveryRejected, Facts: f}
		case now.Total > before.Total:
			return DeliveryTest{Outcome: DeliveryDelivered, Facts: f}
		case time.Since(start) >= deliveryWait:
			return DeliveryTest{Outcome: DeliveryNotDelivered, Facts: f}
		}
		select {
		case <-ctx.Done():
			return DeliveryTest{Outcome: DeliveryNotDelivered, Facts: f}
		case <-t.C:
		}
	}
}

// findTestableHook locates a hook GitLab will send a test delivery for. Group
// and system hooks are one each; under the per-repository scope any repository
// carrying the hook will do, so the first one found is used.
func findTestableHook(ctx context.Context, cfg *config.Config, api GitLabAPI, scope gitlab.HookScope) (projectID, hookID int, err error) {
	switch scope {
	case gitlab.HookScopeGroup:
		list, lerr := api.ListGroupHooks(ctx, cfg.GitLabGitopsGroup)
		if lerr != nil {
			return 0, 0, lerr
		}
		if h := findHook(list, cfg.GitLabWebhookURL); h != nil {
			return 0, h.ID, nil
		}
	case gitlab.HookScopeSystem:
		list, lerr := api.ListSystemHooks(ctx)
		if lerr != nil {
			return 0, 0, lerr
		}
		if h := findHook(list, cfg.GitLabWebhookURL); h != nil {
			return 0, h.ID, nil
		}
	case gitlab.HookScopeProject:
		projects, lerr := api.ListGroupProjects(ctx)
		if lerr != nil {
			return 0, 0, lerr
		}
		for _, p := range projects {
			list, herr := api.ListProjectHooks(ctx, p.ID)
			if herr != nil {
				continue
			}
			if h := findHook(list, cfg.GitLabWebhookURL); h != nil {
				return p.ID, h.ID, nil
			}
		}
	}
	return 0, 0, nil
}
