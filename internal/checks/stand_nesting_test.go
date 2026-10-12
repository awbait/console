package checks

import (
	"testing"

	"console/pkg/models"
)

// A stand that does not deploy, sitting under the path of one that does, is
// warned on both pages; unrelated paths say nothing.
func TestStandNesting(t *testing.T) {
	deploy := &models.Stand{ID: "d", Name: "prod", Mode: models.ModeDeploy, GitPath: "managed-services"}
	inside := &models.Stand{ID: "g", Name: "archive", Mode: models.ModeGit, GitPath: "managed-services/archive"}
	beside := &models.Stand{ID: "c", Name: "sandbox", Mode: models.ModeConsole, GitPath: "managed-services-sandbox"}
	all := []*models.Stand{deploy, inside, beside}

	if r := StandNesting(inside, all); r.Verdict != VerdictWarn || r.Reason != reasonNestedInDeploy || r.Facts["stand"] != "prod" {
		t.Fatalf("git-only stand under a deploying one: %+v", r)
	}
	if r := StandNesting(deploy, all); r.Verdict != VerdictWarn || r.Reason != reasonContainsOther || r.Facts["stand"] != "archive" {
		t.Fatalf("deploying stand over a git-only one: %+v", r)
	}
	if r := StandNesting(beside, all); r.Verdict != VerdictSilent {
		t.Fatalf("a sibling path with a shared prefix is not nested: %+v", r)
	}
	if r := StandNesting(&models.Stand{ID: "x", Mode: models.ModeGit}, all); r.Verdict != VerdictSilent {
		t.Fatalf("no path, nothing to say: %+v", r)
	}
}

func TestArgoConnected(t *testing.T) {
	for reason, want := range map[string][2]bool{
		reasonAppsFound:   {true, true},
		reasonAppsPartial: {true, true},
		reasonAppsMissing: {false, true},
		reasonNoOrders:    {true, true},
		ReasonUnavailable: {false, false},
	} {
		got, known := ArgoConnected([]CheckResult{{ID: IDStandArgo, Reason: reason}})
		if got != want[0] || known != want[1] {
			t.Errorf("%s: got %v/%v, want %v/%v", reason, got, known, want[0], want[1])
		}
	}
}

func TestWorst(t *testing.T) {
	if w := Worst(VerdictOK, VerdictSkip, VerdictWarn, VerdictUnknown); w != VerdictWarn {
		t.Fatalf("warn outranks unknown and ok: %s", w)
	}
	if w := Worst(VerdictWarn, VerdictFail); w != VerdictFail {
		t.Fatalf("fail outranks warn: %s", w)
	}
	if w := Worst(VerdictSkip); w != VerdictSkip {
		t.Fatalf("only skips: %s", w)
	}
}
