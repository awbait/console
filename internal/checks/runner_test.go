package checks

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"console/internal/auth"
	"console/internal/config"
	"console/internal/gitlab"
	"console/internal/harbor"
	"console/pkg/models"
)

func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// find returns one result of a snapshot by check id.
func find(t *testing.T, snap Snapshot, id string) CheckResult {
	t.Helper()
	for _, r := range snap.Results {
		if r.ID == id {
			return r
		}
	}
	t.Fatalf("no result for %q", id)
	return CheckResult{}
}

func TestRunnerRunsEveryCheckOnce(t *testing.T) {
	var mu sync.Mutex
	ran := map[string]int{}
	mk := func(id, component string, v Verdict) Check {
		return Check{ID: id, Component: component, Vars: []string{"X"}, Run: func(context.Context) Result {
			mu.Lock()
			ran[id]++
			mu.Unlock()
			return Result{Verdict: v}
		}}
	}
	r := NewRunner(quietLogger(), nil,
		mk("a", ComponentPortal, VerdictOK),
		mk("b", ComponentGitLab, VerdictFail),
	)
	r.round(context.Background())

	snap := r.Snapshot()
	if len(snap.Results) != 2 {
		t.Fatalf("got %d results, want 2", len(snap.Results))
	}
	if snap.CheckedAt.IsZero() {
		t.Fatal("the snapshot does not say when it was taken")
	}
	if snap.Running {
		t.Fatal("the round has finished but the snapshot still says it is running")
	}
	if find(t, snap, "b").Verdict != VerdictFail {
		t.Fatal("the failing check did not come back as failing")
	}
	// Results keep declaration order, so the page does not reshuffle between
	// refreshes.
	if snap.Results[0].ID != "a" || snap.Results[1].ID != "b" {
		t.Fatalf("results came back in order %s, %s", snap.Results[0].ID, snap.Results[1].ID)
	}
	if ran["a"] != 1 || ran["b"] != 1 {
		t.Fatalf("checks ran %v times, want once each", ran)
	}
}

func TestRunnerReportsUnknownBeforeTheFirstRound(t *testing.T) {
	r := NewRunner(quietLogger(), nil, Check{
		ID: "a", Component: ComponentGitLab,
		Run: func(context.Context) Result { return ok(nil) },
	})
	// Before it has looked, the portal must claim neither that a configuration
	// is fine nor that it is broken.
	if v := find(t, r.Snapshot(), "a").Verdict; v != VerdictUnknown {
		t.Fatalf("got %s, want unknown", v)
	}
}

func TestRunnerDoesNotProbeAComponentThatIsDown(t *testing.T) {
	touched := false
	r := NewRunner(quietLogger(),
		func(component string) bool { return component != ComponentHarbor },
		Check{ID: "h", Component: ComponentHarbor, Run: func(context.Context) Result {
			touched = true
			return verdict(VerdictFail, "boom", nil)
		}},
		Check{ID: "p", Component: ComponentPortal, Run: func(context.Context) Result { return ok(nil) }},
	)
	r.round(context.Background())

	if touched {
		t.Fatal("a check ran against a component that is down")
	}
	got := find(t, r.Snapshot(), "h")
	// "Harbor is down" is said once, at the top of the page. A check behind it
	// must not repeat it as a failure of its own.
	if got.Verdict != VerdictUnknown || got.Reason != ReasonUpstreamDown {
		t.Fatalf("got %s/%s, want unknown/%s", got.Verdict, got.Reason, ReasonUpstreamDown)
	}
	if find(t, r.Snapshot(), "p").Verdict != VerdictOK {
		t.Fatal("a static check was muted by an upstream being down")
	}
}

func TestRunnerTriggerCoalesces(t *testing.T) {
	r := NewRunner(quietLogger(), nil, Check{
		ID: "a", Component: ComponentPortal,
		Run: func(context.Context) Result { return ok(nil) },
	})
	for range 5 {
		r.Trigger("test")
	}
	if len(r.trigger) != 1 {
		t.Fatalf("%d rounds queued, want 1", len(r.trigger))
	}
}

// --- Keycloak ---------------------------------------------------------------

type fakeSignIns struct{ last auth.SignIn }

func (f fakeSignIns) Last() auth.SignIn { return f.last }

func TestKeycloakGroupsClaim(t *testing.T) {
	cfg := &config.Config{AdminGroups: []string{"platform-admins"}}
	now := time.Now()
	cases := []struct {
		name   string
		last   auth.SignIn
		want   Verdict
		reason string
	}{
		{"nobody has signed in yet", auth.SignIn{}, VerdictUnknown, reasonNoSignIn},
		{
			// The quietest failure the portal has: everyone becomes an auditor
			// and the portal looks entirely normal.
			"the token carried no groups",
			auth.SignIn{At: now, Groups: 0, Role: string(models.RoleAuditor)},
			VerdictFail, reasonNoGroups,
		},
		{
			"groups arrived and matched nothing",
			auth.SignIn{At: now, Groups: 3, Teams: 0, Role: string(models.RoleAuditor)},
			VerdictWarn, reasonNoTeams,
		},
		{
			"groups resolved to a team",
			auth.SignIn{At: now, Groups: 2, Teams: 1, Role: string(models.RoleMember)},
			VerdictOK, "",
		},
		{
			"an administrator signed in, so the mapping evidently works",
			auth.SignIn{At: now, Groups: 1, Teams: 0, Role: string(models.RoleAdmin)},
			VerdictOK, "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := keycloakGroups(cfg, fakeSignIns{tc.last})
			if got.Verdict != tc.want || got.Reason != tc.reason {
				t.Fatalf("got %s/%s, want %s/%s", got.Verdict, got.Reason, tc.want, tc.reason)
			}
		})
	}
	t.Run("no admin group means nobody can ever be an admin", func(t *testing.T) {
		got := keycloakGroups(&config.Config{}, fakeSignIns{auth.SignIn{At: now, Groups: 1, Teams: 1}})
		if got.Verdict != VerdictWarn || got.Reason != reasonRolesUnused {
			t.Fatalf("got %s/%s", got.Verdict, got.Reason)
		}
	})
}

// --- Harbor artifacts --------------------------------------------------------

func TestHarborArtifacts(t *testing.T) {
	repos := map[string][]harbor.RepoRef{"platform": {{Project: "platform", Name: "postgres"}}}
	t.Run("the robot can read them", func(t *testing.T) {
		api := &fakeHarbor{repos: repos, artifacts: 3}
		got := harborArtifacts(context.Background(), api, []string{"platform"})
		if got.Verdict != VerdictOK || got.Facts["artifacts"] != "3" {
			t.Fatalf("got %s/%s facts=%v", got.Verdict, got.Reason, got.Facts)
		}
	})
	t.Run("listing works and reading does not", func(t *testing.T) {
		// Harbor grants "list repositories" and "read artifacts" separately, so
		// this is a catalog where every chart has no versions.
		api := &fakeHarbor{repos: repos, artErr: models.ErrNotFound}
		got := harborArtifacts(context.Background(), api, []string{"platform"})
		if got.Verdict != VerdictUnknown {
			t.Fatalf("got %s/%s", got.Verdict, got.Reason)
		}
	})
	t.Run("nothing published yet", func(t *testing.T) {
		got := harborArtifacts(context.Background(), &fakeHarbor{}, []string{"platform"})
		if got.Verdict != VerdictSkip {
			t.Fatalf("got %s/%s", got.Verdict, got.Reason)
		}
	})
}

// --- the active delivery test ------------------------------------------------

// movingDeliveries reports one more delivery of the given kind after the first
// read, standing in for a webhook that arrives while the portal is waiting.
type movingDeliveries struct {
	mu       sync.Mutex
	reads    int
	rejected bool
}

func (m *movingDeliveries) Since() time.Time { return time.Time{} }

func (m *movingDeliveries) Get(string) DeliveryCounts {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.reads++
	if m.reads <= 1 {
		return DeliveryCounts{}
	}
	if m.rejected {
		return DeliveryCounts{Rejected: 1, Total: 1}
	}
	return DeliveryCounts{Accepted: 1, Total: 1}
}

func TestGitLabDeliveryTest(t *testing.T) {
	const hookURL = "https://portal.example.com/api/v1/webhooks/gitlab"
	cfg := &config.Config{GitLabWebhookURL: hookURL, GitLabWebhookToken: "s", GitLabGitopsGroup: "managed-services"}
	hook := gitlab.HookInfo{ID: 7, URL: hookURL, MergeRequestsEvents: true}

	t.Run("it arrived", func(t *testing.T) {
		api := &fakeGitLab{groupHooks: []gitlab.HookInfo{hook}}
		got := TestGitLabDelivery(context.Background(), cfg, api, scopeOf(gitlab.HookScopeGroup), &movingDeliveries{})
		if got.Outcome != DeliveryDelivered {
			t.Fatalf("got %s, want %s", got.Outcome, DeliveryDelivered)
		}
		if api.tested != 1 {
			t.Fatalf("asked GitLab for %d test deliveries, want 1", api.tested)
		}
	})
	t.Run("it arrived and was refused, which is the only way to see a secret mismatch", func(t *testing.T) {
		api := &fakeGitLab{groupHooks: []gitlab.HookInfo{hook}}
		got := TestGitLabDelivery(context.Background(), cfg, api, scopeOf(gitlab.HookScopeGroup), &movingDeliveries{rejected: true})
		if got.Outcome != DeliveryRejected {
			t.Fatalf("got %s, want %s", got.Outcome, DeliveryRejected)
		}
	})
	t.Run("gitlab refused to send it", func(t *testing.T) {
		api := &fakeGitLab{groupHooks: []gitlab.HookInfo{hook}, testErr: errors.New("no merge requests in this project")}
		got := TestGitLabDelivery(context.Background(), cfg, api, scopeOf(gitlab.HookScopeGroup), &movingDeliveries{})
		if got.Outcome != DeliveryFailed || got.Detail == "" {
			t.Fatalf("got %s detail=%q", got.Outcome, got.Detail)
		}
	})
	t.Run("nothing is registered", func(t *testing.T) {
		got := TestGitLabDelivery(context.Background(), cfg, &fakeGitLab{}, scopeOf(gitlab.HookScopeNone), &movingDeliveries{})
		if got.Outcome != DeliveryNotRegistered {
			t.Fatalf("got %s, want %s", got.Outcome, DeliveryNotRegistered)
		}
	})
	t.Run("nothing is configured", func(t *testing.T) {
		got := TestGitLabDelivery(context.Background(), &config.Config{}, &fakeGitLab{}, scopeOf(gitlab.HookScopeNone), &movingDeliveries{})
		if got.Outcome != DeliveryNotConfigured {
			t.Fatalf("got %s, want %s", got.Outcome, DeliveryNotConfigured)
		}
	})
	t.Run("it never arrived", func(t *testing.T) {
		// The wait is ten seconds; a cancelled context ends it at once and
		// reports the same thing, which is what a person who navigates away gets.
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		api := &fakeGitLab{groupHooks: []gitlab.HookInfo{hook}}
		got := TestGitLabDelivery(ctx, cfg, api, scopeOf(gitlab.HookScopeGroup), fakeDeliveries{})
		if got.Outcome != DeliveryNotDelivered {
			t.Fatalf("got %s, want %s", got.Outcome, DeliveryNotDelivered)
		}
	})
}
