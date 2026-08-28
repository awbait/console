package auth_test

import (
	"testing"
	"time"

	"console/internal/auth"
)

// TestSignInIsAnnouncedToTheOtherReplicas: sessions are shared, so a person
// signs in through one replica and works on any of them. The evidence of what
// their token carried has to travel with them.
func TestSignInIsAnnouncedToTheOtherReplicas(t *testing.T) {
	s := auth.NewSignIns()
	var heard []auth.SignIn
	s.Announce = func(in auth.SignIn) { heard = append(heard, in) }

	s.Record(3, 1, "member")

	if len(heard) != 1 {
		t.Fatalf("announced %d sign-ins, want 1", len(heard))
	}
	if heard[0].Groups != 3 || heard[0].Teams != 1 || heard[0].Role != "member" {
		t.Fatalf("announced %+v, want what the token carried", heard[0])
	}
	if heard[0].At.IsZero() {
		t.Fatal("announced a sign-in with no time, so no replica can tell it from an older one")
	}
}

// TestASignInFromAnotherReplicaIsRemembered is what makes the Keycloak check
// work on a replica that has not served a login itself.
func TestASignInFromAnotherReplicaIsRemembered(t *testing.T) {
	s := auth.NewSignIns()
	if !s.Last().At.IsZero() {
		t.Fatal("a fresh recorder claims to have seen a sign-in")
	}

	elsewhere := auth.SignIn{At: time.Now(), Groups: 2, Teams: 1, Role: "admin"}
	s.Apply(elsewhere)

	if got := s.Last(); got.Groups != 2 || got.Role != "admin" {
		t.Fatalf("last sign-in is %+v, want the one served by the other replica", got)
	}
}

// TestTheMostRecentSignInWins: events arrive in whatever order the bus hands
// them over, and a replica's own sign-in comes back around to it. Neither may
// replace something newer.
func TestTheMostRecentSignInWins(t *testing.T) {
	s := auth.NewSignIns()
	now := time.Now()

	s.Apply(auth.SignIn{At: now, Groups: 5, Role: "admin"})
	s.Apply(auth.SignIn{At: now.Add(-time.Minute), Groups: 0, Role: "auditor"})

	if got := s.Last(); got.Groups != 5 || got.Role != "admin" {
		t.Fatalf("last sign-in is %+v, want the newer one", got)
	}

	s.Apply(auth.SignIn{At: now.Add(time.Minute), Groups: 1, Role: "member"})
	if got := s.Last(); got.Role != "member" {
		t.Fatalf("last sign-in is %+v, want the one that came after it", got)
	}
}

// TestApplyIgnoresASignInWithNoTime: a payload the portal could not read is not
// evidence of anything, and must not pass for a sign-in that never happened.
func TestApplyIgnoresASignInWithNoTime(t *testing.T) {
	s := auth.NewSignIns()
	s.Apply(auth.SignIn{Groups: 4, Role: "admin"})
	if !s.Last().At.IsZero() {
		t.Fatal("a sign-in with no time was recorded as one that happened")
	}
}
