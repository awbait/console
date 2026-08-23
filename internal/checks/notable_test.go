package checks

import "testing"

// What gets somebody woken up and what stays on the page. The line is not the
// verdict: a misconfiguration is red too, and it is red from the moment it was
// deployed, in front of the person who deployed it.
func TestOnlyWhatBreaksByItselfIsNotable(t *testing.T) {
	cases := []struct {
		name string
		res  CheckResult
		want string // the event key, "" for nothing to announce
	}{
		{"a token that ran out", CheckResult{ID: IDGitLabToken, Verdict: VerdictFail, Reason: reasonExpired}, reasonExpired},
		{"a token somebody withdrew", CheckResult{ID: IDGitLabToken, Verdict: VerdictFail, Reason: reasonRevoked}, reasonRevoked},
		{"a webhook GitLab switched off", CheckResult{ID: IDGitLabHook, Verdict: VerdictFail, Reason: reasonHookDisabled}, reasonHookDisabled},
		{"deliveries refused on the secret", CheckResult{ID: IDHarborHook, Verdict: VerdictFail, Reason: reasonSecretMismatch}, reasonSecretMismatch},
		{"a Harbor project that disappeared", CheckResult{ID: IDHarborProjects, Verdict: VerdictFail, Reason: reasonProjectsMissing}, reasonProjectsMissing},
		{"an Argo CD cluster that disappeared", CheckResult{ID: IDArgoCluster, Verdict: VerdictFail, Reason: reasonClusterMissing}, reasonClusterMissing},

		// Set wrong rather than broken: the configuration page says so, and has
		// said so since the day it was deployed.
		{"a token without the api scope", CheckResult{ID: IDGitLabToken, Verdict: VerdictFail, Reason: reasonMissingScope}, ""},
		{"a role too low to create subgroups", CheckResult{ID: IDGitLabGroup, Verdict: VerdictFail, Reason: reasonNeedsOwner}, ""},
		{"a template that does not tell services apart", CheckResult{ID: IDInstanceDirTmpl, Verdict: VerdictFail, Reason: reasonNotUnique}, ""},
		{"a webhook on some repositories only", CheckResult{ID: IDGitLabHook, Verdict: VerdictWarn, Reason: reasonPartialHooks}, ""},
		// The check did not run at all.
		{"GitLab did not answer", CheckResult{ID: IDGitLabToken, Verdict: VerdictUnknown, Reason: ReasonUpstreamDown}, ""},
		{"the token cannot be introspected", CheckResult{ID: IDGitLabToken, Verdict: VerdictUnknown, Reason: reasonNoIntrospect}, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ev, ok := Notable(c.res)
			if ok != (c.want != "") {
				t.Fatalf("notable = %v, want %v", ok, c.want != "")
			}
			if ok && ev.Key != c.want {
				t.Errorf("key = %q, want %q", ev.Key, c.want)
			}
		})
	}
}

// The expiry is announced twice, so it has to be two different events: one key
// for the month's notice and another for the week's, or the second message is
// taken for a repeat of the first and never sent.
func TestExpiryHasOneEventPerThreshold(t *testing.T) {
	key := func(days string) string {
		ev, ok := Notable(CheckResult{
			ID: IDGitLabToken, Verdict: VerdictWarn, Reason: reasonExpiresSoon,
			Facts: map[string]string{"days_left": days},
		})
		if !ok {
			t.Fatalf("%s days left is not notable", days)
		}
		return ev.Key
	}
	month, week := key("30"), key("7")
	if month == week {
		t.Fatalf("a month and a week ahead share the key %q", month)
	}
	for _, days := range []string{"29", "14", "8"} {
		if got := key(days); got != month {
			t.Errorf("%s days left = %q, want the month's notice %q", days, got, month)
		}
	}
	for _, days := range []string{"6", "1", "0"} {
		if got := key(days); got != week {
			t.Errorf("%s days left = %q, want the week's notice %q", days, got, week)
		}
	}
	// A GitLab that will not say how many days are left still gets one message.
	if key("") != month {
		t.Errorf("an unreadable count = %q, want the month's notice %q", key(""), month)
	}
}
