package checks

import (
	"strings"

	"console/pkg/models"
)

// IDStandNesting is the check that one stand's path is not inside another's
// in a way Argo CD would act on.
const IDStandNesting = "stand_nesting"

// Reasons of the nesting check.
const (
	reasonNestedInDeploy = "nested_in_deploy" // this stand does not deploy, but sits under a stand whose Argo CD walks its path
	reasonContainsOther  = "contains_other"   // this stand deploys, and a stand that does not sits under its path
)

// StandNesting warns when the files of a stand that does not deploy lie
// under the path of a stand that does: the deploying stand's app-of-apps
// walks everything under its path and would deploy them. "Git only" is a
// convention about where the files are, not a flag Argo CD reads, so the
// convention is checked here. Nothing to say is silent: a clear path is not
// a row.
func StandNesting(st *models.Stand, all []*models.Stand) CheckResult {
	r := CheckResult{ID: IDStandNesting, Component: ComponentPortal, Verdict: VerdictSilent}
	if st == nil || st.GitPath == "" {
		return r
	}
	for _, o := range all {
		if o == nil || o.ID == st.ID || o.GitPath == "" {
			continue
		}
		switch {
		case !st.Deploys() && o.Deploys() && within(st.GitPath, o.GitPath):
			r.Verdict, r.Reason = VerdictWarn, reasonNestedInDeploy
			r.Facts = map[string]string{"stand": o.Name, "path": o.GitPath}
			return r
		case st.Deploys() && !o.Deploys() && within(o.GitPath, st.GitPath):
			r.Verdict, r.Reason = VerdictWarn, reasonContainsOther
			r.Facts = map[string]string{"stand": o.Name, "path": o.GitPath}
			return r
		}
	}
	return r
}

// within reports whether path p is parent itself or lies under it.
func within(p, parent string) bool {
	return p == parent || strings.HasPrefix(p, parent+"/")
}

// ArgoConnected reads the stand's application check: whether Argo CD sees
// the stand's applications, and whether the check could tell at all. A stand
// with no order left has nothing waiting on the wiring, so it counts as
// wired again; an upstream that did not answer leaves the question open.
func ArgoConnected(results []CheckResult) (connected, known bool) {
	for _, r := range results {
		if r.ID != IDStandArgo {
			continue
		}
		switch r.Reason {
		case reasonAppsFound, reasonAppsPartial, reasonNoOrders:
			return true, true
		case reasonAppsMissing:
			return false, true
		}
	}
	return false, false
}

// Worst is the most severe of the verdicts, for a summary that has one word
// for a stand: a failure outranks a warning, a warning outranks not knowing,
// and skipped checks say nothing at all.
func Worst(verdicts ...Verdict) Verdict {
	rank := map[Verdict]int{VerdictSkip: 0, VerdictSilent: 0, VerdictOK: 1, VerdictUnknown: 2, VerdictWarn: 3, VerdictFail: 4}
	out := VerdictSkip
	for _, v := range verdicts {
		if rank[v] > rank[out] {
			out = v
		}
	}
	return out
}
