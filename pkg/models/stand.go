package models

import "time"

// Stand is a deployment target an order is placed on: a named place with its
// own default cluster and, later, its own variable values, Git layout and
// mode. A stand may span several clusters, so the cluster itself stays a field
// of the order; the stand only says which one an order starts with.
//
// It is a global entity, not a team's: every team orders onto the same stands
// and sees only its own orders there. Orders are attached to a stand at
// creation and keep it for good, the way they keep their namespace: the stand
// decides where the files go and which variable values apply, and moving
// either is a different order (see the copy-to-stand action).
type Stand struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// DefaultCluster is the Argo CD destination.name the order form opens with
	// for this stand. The order may name another cluster of the same stand; what
	// it names is what it keeps (Request.Cluster).
	DefaultCluster string `json:"default_cluster"`
	// Default marks the stand an order lands on when none is named, and the one
	// every order written before stands existed was attached to. Exactly one
	// stand carries it; moving it is its own operation (SetDefaultStand).
	Default   bool      `json:"default"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// DefaultStandName is what the stand created on the first start after the
// upgrade is called. It is seeded from the configured default cluster so every
// existing order attaches to it without changing where it lives; an admin
// renames it from the stands page.
const DefaultStandName = "default"

// MaxStandName bounds the name: it is shown in a selector, a table column and a
// filter chip, none of which has room for a sentence.
const MaxStandName = 64
