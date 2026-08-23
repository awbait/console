package notify_test

import (
	"context"
	"testing"

	"console/internal/checks"
	"console/internal/notify"
	"console/internal/store"
	"console/pkg/models"
)

// admin is who these notifications are for: they are fixed in GitLab, Harbor or
// Argo CD, and nobody else can get there.
func adminFeed(t *testing.T, st store.Store) []*models.Notification {
	t.Helper()
	list, err := st.ListNotifications(context.Background(), reader("padmin", "admin"))
	if err != nil {
		t.Fatalf("list notifications: %v", err)
	}
	return list
}

// kinds is the feed as a list of what happened, newest last, so a test reads as
// the story it is checking.
func kinds(t *testing.T, st store.Store) []string {
	t.Helper()
	list := adminFeed(t, st)
	out := make([]string, 0, len(list))
	for i := len(list) - 1; i >= 0; i-- {
		out = append(out, list[i].Kind)
	}
	return out
}

func result(id, component string, v checks.Verdict, reason string, facts map[string]string) checks.CheckResult {
	return checks.CheckResult{ID: id, Component: component, Verdict: v, Reason: reason, Facts: facts}
}

func round(w *notify.ConfigWatch, results ...checks.CheckResult) {
	w.Round(context.Background(), results)
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// The whole story of one breakage: it is announced once however long it lasts,
// called off when it is over, and announced again when it comes back. Without
// the last part the second outage is silent, which is worse than never having
// sent the first message.
func TestConfigCheckIsAnnouncedOnceAndCalledOff(t *testing.T) {
	st := store.NewMemory()
	w := notify.New(st, nil, nil).ConfigWatch()

	broken := result(checks.IDArgoProject, checks.ComponentArgoCD, checks.VerdictFail, "project_missing", nil)
	fine := result(checks.IDArgoProject, checks.ComponentArgoCD, checks.VerdictOK, "project_exists", nil)

	round(w, broken)
	round(w, broken) // ten minutes later, still broken: not news
	round(w, broken)
	round(w, fine)
	round(w, fine) // still fine: also not news
	round(w, broken)

	want := []string{
		models.NotifyConfigCheckFailed,
		models.NotifyConfigCheckRecovered,
		models.NotifyConfigCheckFailed,
	}
	if got := kinds(t, st); !equal(got, want) {
		t.Fatalf("feed = %v, want %v", got, want)
	}
}

// An upstream that did not answer is not a verdict. The platform status page
// already says GitLab is down, and a check that could not run must not be read
// as either a new fault or the end of one.
func TestUpstreamDownSaysNothing(t *testing.T) {
	st := store.NewMemory()
	w := notify.New(st, nil, nil).ConfigWatch()

	down := result(checks.IDGitLabHook, checks.ComponentGitLab, checks.VerdictUnknown, checks.ReasonUpstreamDown, nil)
	broken := result(checks.IDGitLabHook, checks.ComponentGitLab, checks.VerdictFail, "hook_disabled", nil)

	round(w, down)
	if got := kinds(t, st); len(got) != 0 {
		t.Fatalf("an upstream that did not answer produced %v", got)
	}
	round(w, broken)
	round(w, down) // it went down again while the hook was still off
	round(w, broken)

	want := []string{models.NotifyConfigCheckFailed}
	if got := kinds(t, st); !equal(got, want) {
		t.Fatalf("feed = %v, want %v", got, want)
	}
}

// A check that goes red for something nobody is told about is not an all-clear
// either: the announced fault may be over, but the page it links to is still
// showing a problem.
func TestAnotherFaultIsNotAnAllClear(t *testing.T) {
	st := store.NewMemory()
	w := notify.New(st, nil, nil).ConfigWatch()

	round(w, result(checks.IDGitLabToken, checks.ComponentGitLab, checks.VerdictFail, "revoked", nil))
	round(w, result(checks.IDGitLabToken, checks.ComponentGitLab, checks.VerdictFail, "missing_scope", nil))

	want := []string{models.NotifyConfigCheckFailed}
	if got := kinds(t, st); !equal(got, want) {
		t.Fatalf("feed = %v, want %v", got, want)
	}
}

// Restarting the portal is not an event. The state is the last notification
// about the check, so a new process picks the story up where the old one left
// it: silent about what was already said, and still able to call it off.
func TestRestartNeitherRepeatsNorForgets(t *testing.T) {
	st := store.NewMemory()
	broken := result(checks.IDHarborProjects, checks.ComponentHarbor, checks.VerdictFail, "projects_missing", nil)
	fine := result(checks.IDHarborProjects, checks.ComponentHarbor, checks.VerdictOK, "charts_readable", nil)

	first := notify.New(st, nil, nil).ConfigWatch()
	round(first, broken)

	restarted := notify.New(st, nil, nil).ConfigWatch()
	round(restarted, broken) // the same fault, a new process: nothing to say
	if got := kinds(t, st); len(got) != 1 {
		t.Fatalf("after a restart the feed = %v, want the one announcement", got)
	}
	round(restarted, fine) // and the all-clear still goes out

	want := []string{models.NotifyConfigCheckFailed, models.NotifyConfigCheckRecovered}
	if got := kinds(t, st); !equal(got, want) {
		t.Fatalf("feed = %v, want %v", got, want)
	}
}

// A token expiry is the one fault said twice: a month ahead, when a new token
// can be got through whatever process issues them, and a week ahead, when it
// stops being a plan.
func TestTokenExpiryIsAnnouncedAtBothThresholds(t *testing.T) {
	st := store.NewMemory()
	w := notify.New(st, nil, nil).ConfigWatch()

	expiring := func(days string) checks.CheckResult {
		return result(checks.IDGitLabToken, checks.ComponentGitLab, checks.VerdictWarn, "expires_soon",
			map[string]string{"days_left": days})
	}
	round(w, expiring("29"))
	round(w, expiring("21"))
	round(w, expiring("8"))
	round(w, expiring("6"))
	round(w, expiring("1"))
	round(w, result(checks.IDGitLabToken, checks.ComponentGitLab, checks.VerdictFail, "expired", nil))

	want := []string{
		models.NotifyConfigCheckFailed, // a month left
		models.NotifyConfigCheckFailed, // a week left
		models.NotifyConfigCheckFailed, // and the day it ran out
	}
	if got := kinds(t, st); !equal(got, want) {
		t.Fatalf("feed = %v, want %v", got, want)
	}
	feed := adminFeed(t, st)
	if got := feed[len(feed)-1].Payload["days_left"]; got == nil {
		t.Error("the first announcement does not say how long is left")
	}
}

// Everything else the checks report stays on the configuration page. A
// notification per warn is a bell that gets ignored, and the one that mattered
// is ignored with it.
func TestOnlyWhatBreaksByItselfIsAnnounced(t *testing.T) {
	st := store.NewMemory()
	w := notify.New(st, nil, nil).ConfigWatch()

	round(w,
		result(checks.IDGitLabHook, checks.ComponentGitLab, checks.VerdictWarn, "partial_coverage", nil),
		result(checks.IDGitLabGroup, checks.ComponentGitLab, checks.VerdictFail, "needs_owner", nil),
		result(checks.IDInstanceDirTmpl, checks.ComponentPortal, checks.VerdictFail, "not_unique", nil),
		result(checks.IDHarborHook, checks.ComponentHarbor, checks.VerdictFail, "no_policy", nil),
	)
	if got := kinds(t, st); len(got) != 0 {
		t.Fatalf("a misconfiguration was announced: %v", got)
	}
}

// The notification carries what the sentence needs and where to go: the
// configuration page is the only place the detail and the fix are written.
func TestAnnouncementSaysWhatAndWhere(t *testing.T) {
	st := store.NewMemory()
	w := notify.New(st, nil, nil).ConfigWatch()
	round(w, result(checks.IDGitLabHook, checks.ComponentGitLab, checks.VerdictFail, "secret_mismatch", nil))

	feed := adminFeed(t, st)
	if len(feed) != 1 {
		t.Fatalf("feed = %v, want one announcement", feed)
	}
	n := feed[0]
	if n.SubjectType != models.SubjectPlatform || n.SubjectID != "config:gitlab_webhook" {
		t.Errorf("subject = %s/%s, want the check it is about", n.SubjectType, n.SubjectID)
	}
	if n.Level != models.LevelAttention {
		t.Errorf("level = %s, want attention", n.Level)
	}
	if n.Payload["check"] != "gitlab_webhook" || n.Payload["reason"] != "secret_mismatch" {
		t.Errorf("payload = %v, want the check and the reason", n.Payload)
	}
}
