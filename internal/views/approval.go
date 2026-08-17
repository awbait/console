package views

import "encoding/json"

// The "approval" block of a view document is where a version says how its
// changes are allowed to reach the cluster. Today it holds one rule; the block
// exists so the rest of that policy (who has to review, which team signs off)
// has somewhere to land without moving anything.
//
//	{ "approval": { "autoMerge": false } }
//
// A service whose every change has to be read by a person before it deploys
// (network policies, anything the security team owns) declares it here rather
// than in the portal's own configuration: the requirement belongs to the
// service, not to the installation it happens to run in.

// AutoMergeRule is what a version says about merging its changes without a
// person. Silence is not "no" - it means the installation decides, which is why
// this is not a plain bool.
type AutoMergeRule struct {
	// Declared reports whether the version said anything at all.
	Declared bool
	// Allowed is what it said. Meaningless unless Declared.
	Allowed bool
}

// ReadAutoMergeRule returns the version's rule for merging its own changes.
// A document that says nothing, or says it in a shape this portal does not
// understand, leaves the decision to the installation.
func ReadAutoMergeRule(viewJSON []byte) AutoMergeRule {
	var doc struct {
		Approval struct {
			AutoMerge *bool `json:"autoMerge"`
		} `json:"approval"`
	}
	if err := json.Unmarshal(viewJSON, &doc); err != nil || doc.Approval.AutoMerge == nil {
		return AutoMergeRule{}
	}
	return AutoMergeRule{Declared: true, Allowed: *doc.Approval.AutoMerge}
}

// AutoMergeAllowed answers whether the portal may merge this version's changes
// itself. The installation's setting is a ceiling, not a default: a version can
// refuse unattended merges, and none can grant them where the installation has
// turned them off. Somebody who switches GITLAB_AUTO_MERGE off is saying "no
// merges happen here without a person", and a chart document is not the place
// to overrule that.
func AutoMergeAllowed(viewJSON []byte, installationAllows bool) bool {
	if !installationAllows {
		return false
	}
	rule := ReadAutoMergeRule(viewJSON)
	return !rule.Declared || rule.Allowed
}
