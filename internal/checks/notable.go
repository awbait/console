package checks

import (
	"slices"
	"strconv"
)

// What is worth waking the platform team for, as opposed to what the
// configuration page is for.
//
// A check goes red for two different kinds of reason, and only one of them is
// news. Something set wrong is set wrong from the moment it is deployed: it is
// found by whoever deployed it, on the page that says so, and it stays there
// until somebody fixes it. Something else breaks on its own, with nobody
// touching the portal at all - a token reaches its expiry date, GitLab switches
// a webhook off after a run of failed deliveries, the secret is rotated on one
// side, a project is deleted. Nothing brings anyone to the page to see that,
// and in practice it is learnt from the person whose order did not go through.
//
// So the list here is short on purpose. A notification for every warn is a bell
// that gets ignored, and then the one that mattered is ignored with it.

// Event is a turn in a check's verdict the platform team is told about.
type Event struct {
	Check     string
	Component string
	Reason    string
	// Key names this turn for whoever keeps track of what has already been
	// said. It is the reason, plus the threshold where one reason is worth
	// saying twice: a token expiring in a month and the same token expiring in
	// a week are two different pieces of news, and the second one is the one
	// that gets acted on.
	Key   string
	Facts map[string]string
}

// notableReasons is the whole list, per check.
var notableReasons = map[string][]string{
	IDGitLabToken:    {reasonExpired, reasonRevoked, reasonExpiresSoon},
	IDGitLabHook:     {reasonHookDisabled, reasonSecretMismatch},
	IDHarborHook:     {reasonSecretMismatch},
	IDHarborProjects: {reasonProjectsMissing, reasonProjectsHidden},
	IDArgoProject:    {reasonProjectMissing},
	IDArgoCluster:    {reasonClusterMissing},
}

// expiryStages are the days left on a token at which its expiry is announced.
// A month ahead is when a new token can still be got through whatever process
// issues them; a week ahead is when it stops being a plan and becomes today's
// work.
var expiryStages = []int{30, 7}

// Notable reports whether a result is one of those turns, and describes it.
func Notable(res CheckResult) (Event, bool) {
	// Only a verdict that judged something. Unknown is the upstream not
	// answering, and that is already said by the platform status page - and
	// said there once for the whole system rather than once per check that
	// could not run because of it.
	if res.Verdict != VerdictFail && res.Verdict != VerdictWarn {
		return Event{}, false
	}
	if !slices.Contains(notableReasons[res.ID], res.Reason) {
		return Event{}, false
	}
	ev := Event{
		Check:     res.ID,
		Component: res.Component,
		Reason:    res.Reason,
		Key:       res.Reason,
		Facts:     res.Facts,
	}
	if res.Reason == reasonExpiresSoon {
		ev.Key = res.Reason + ":" + strconv.Itoa(expiryStage(res.Facts["days_left"]))
	}
	return ev, true
}

// expiryStage is the threshold a token with this many days left has reached.
// An unreadable count is treated as the far one: it is still worth one message,
// and a token whose expiry the portal cannot count down to will be announced
// again as soon as it can.
func expiryStage(daysLeft string) int {
	days, err := strconv.Atoi(daysLeft)
	if err != nil {
		return expiryStages[0]
	}
	stage := expiryStages[0]
	for _, s := range expiryStages {
		if days <= s {
			stage = s
		}
	}
	return stage
}
