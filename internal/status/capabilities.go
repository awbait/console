package status

// The portal is not one system but a front for several: Keycloak lets people in,
// Harbor holds the charts, GitLab receives the merge requests, Argo CD reports
// what is actually running. When one of them is down the portal keeps working -
// only some of what it offers stops. This file is the map from components to
// what a person can no longer do, so the UI can say "ordering is unavailable"
// instead of "harbor: dial tcp: i/o timeout".
//
// Only identifiers live here. The sentences the user reads are written on the
// front end (web/src/app/capabilities.ts), next to the rest of the product copy.

// Capability ids, mirrored in web/src/app/capabilities.ts.
const (
	CapSignIn       = "sign_in"       // signing in to the portal
	CapCatalog      = "catalog"       // browsing the service catalog and its versions
	CapOrdering     = "ordering"      // ordering, changing and deleting a service
	CapOrders       = "orders"        // the order list and its history
	CapDeployStatus = "deploy_status" // live state of what is deployed
	CapPublishing   = "publishing"    // publishing services into the catalog and approving them
)

// Capability is one thing the portal offers and the components it needs for it.
type Capability struct {
	ID        string
	DependsOn []string // component names, as reported by the probes
}

// Capabilities is the dependency map, in the order the UI lists them.
//
// Redis (the "cache" component) is deliberately absent: it only speeds up chart
// blobs (see internal/catalog.Service.blob), and losing it costs latency, not a
// capability. PostgreSQL ("store") is under everything that reads or writes
// portal state, so it is listed on every capability but sign-in - a session is
// sealed in the cookie and needs no database.
var Capabilities = []Capability{
	{ID: CapSignIn, DependsOn: []string{"keycloak"}},
	{ID: CapCatalog, DependsOn: []string{"harbor", "store"}},
	{ID: CapOrdering, DependsOn: []string{"harbor", "gitlab", "store"}},
	{ID: CapOrders, DependsOn: []string{"store"}},
	{ID: CapDeployStatus, DependsOn: []string{"argocd", "store"}},
	{ID: CapPublishing, DependsOn: []string{"harbor", "store"}},
}

// CapabilityState is one capability and whether it currently works.
type CapabilityState struct {
	ID string `json:"id"`
	OK bool   `json:"ok"`
}

// Evaluate maps component health onto the capabilities, in declaration order. A
// capability is broken when any component it depends on is down; a dependency
// nobody probes (an unwired component in tests) is treated as working.
func Evaluate(states []ComponentState) []CapabilityState {
	down := make(map[string]bool, len(states))
	for _, st := range states {
		if !st.OK {
			down[st.Name] = true
		}
	}
	out := make([]CapabilityState, 0, len(Capabilities))
	for _, c := range Capabilities {
		ok := true
		for _, dep := range c.DependsOn {
			if down[dep] {
				ok = false
				break
			}
		}
		out = append(out, CapabilityState{ID: c.ID, OK: ok})
	}
	return out
}

// AllOK reports whether every capability works.
func AllOK(caps []CapabilityState) bool {
	for _, c := range caps {
		if !c.OK {
			return false
		}
	}
	return true
}
