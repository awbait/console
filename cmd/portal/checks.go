package main

import (
	"context"
	"log/slog"
	"time"

	"console/internal/argocd"
	"console/internal/auth"
	"console/internal/checks"
	"console/internal/config"
	"console/internal/gitlab"
	"console/internal/harbor"
	"console/internal/status"
	"console/internal/webhooks"
)

// Wiring for the configuration checks (internal/checks). It lives here because
// this is where the concrete upstream clients exist: the API server holds the
// narrow ports the provisioning flow needs, and the checks read things those
// ports deliberately do not expose - who a token belongs to, what a hook is
// registered on, which projects a robot can actually see.

// buildChecks assembles the whole check set and the runner over it. A component
// that did not answer its last health probe is not read at all: its checks
// report "we could not look", which is a different thing from "this is broken"
// and is already said once, at the top of the same page.
func buildChecks(
	cfg *config.Config,
	hb *harbor.Client,
	gl *gitlab.Client,
	argo *argocd.Client,
	hooks *gitlab.HookManager,
	wh *webhooks.Handler,
	signIns *auth.SignIns,
	health *status.Monitor,
	log *slog.Logger,
) *checks.Runner {
	deliveries := deliveryCounts{wh.Deliveries()}
	set := checks.Static(cfg)
	set = append(set, checks.GitLabChecks(cfg, gl, hooks, deliveries)...)
	set = append(set, checks.HarborChecks(cfg, hb, deliveries)...)
	set = append(set, checks.ArgoCDChecks(cfg, argo)...)
	set = append(set, checks.KeycloakChecks(cfg, signIns)...)
	return checks.NewRunner(log, componentHealth(health), set...)
}

// componentHealth reports whether a component answered its last probe. A
// component nobody probes counts as up, so an unwired monitor does not mute
// every check behind it.
func componentHealth(m *status.Monitor) func(string) bool {
	return func(name string) bool {
		for _, st := range m.Snapshot() {
			if st.Name == name {
				return st.OK
			}
		}
		return true
	}
}

// deliveryCounts adapts the webhook handler's counters to what the checks read.
// The shapes are the same; the indirection is what keeps internal/checks from
// depending on the HTTP layer for one struct.
type deliveryCounts struct{ d *webhooks.Deliveries }

func (a deliveryCounts) Since() time.Time { return a.d.Since() }

func (a deliveryCounts) Get(source string) checks.DeliveryCounts {
	c := a.d.Get(source)
	return checks.DeliveryCounts{
		Accepted:     c.Accepted,
		Rejected:     c.Rejected,
		BadRequest:   c.BadRequest,
		LastAccepted: c.LastAccepted,
		LastRejected: c.LastRejected,
		Total:        c.Total(),
	}
}

// webhookDeliveryTest binds the one active check to the pieces it needs, so the
// API server can offer it as a single call behind its admin-only route.
func webhookDeliveryTest(cfg *config.Config, gl *gitlab.Client, hooks *gitlab.HookManager, wh *webhooks.Handler) func(context.Context) checks.DeliveryTest {
	deliveries := deliveryCounts{wh.Deliveries()}
	return func(ctx context.Context) checks.DeliveryTest {
		return checks.TestGitLabDelivery(ctx, cfg, gl, hooks, deliveries)
	}
}
