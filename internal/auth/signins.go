package auth

import (
	"sync"
	"time"
)

// What the last sign-in actually carried.
//
// Whether Keycloak really puts the group claim in the tokens it issues cannot be
// asked of Keycloak: the discovery document says nothing about it, and the
// portal has no client credentials of its own to mint a token with. It is only
// visible in a token that has been issued - so the portal remembers what the
// last one held.
//
// The consequence of getting this wrong is quiet by design: with no groups
// claim, RBAC derives no teams and no role, everyone who signs in becomes an
// auditor, and nobody reports it because the portal opens and looks fine.

// SignIn is what the last successful sign-in looked like, in facts a status page
// may show. It names no person: this is about the realm's configuration, not
// about who logged in.
type SignIn struct {
	// At is when it happened; zero means nobody has signed in since the portal
	// started.
	At time.Time
	// Groups is how many groups the token carried.
	Groups int
	// Teams is how many of them resolved to a portal team, and Role is the role
	// the user ended up with. Groups present but nothing resolved means the
	// claim is there and RBAC_TEAM_GROUP_PREFIX does not match it.
	Teams int
	Role  string
}

// SignIns remembers the last successful sign-in. Safe for concurrent use; a nil
// receiver records nothing, so an authenticator built without one still works.
type SignIns struct {
	mu   sync.Mutex
	last SignIn
}

// NewSignIns builds an empty recorder.
func NewSignIns() *SignIns { return &SignIns{} }

// Record notes a sign-in that produced a session.
func (s *SignIns) Record(groups, teams int, role string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.last = SignIn{At: time.Now(), Groups: groups, Teams: teams, Role: role}
}

// Last returns the last recorded sign-in. A zero At means there has not been one
// since the portal started.
func (s *SignIns) Last() SignIn {
	if s == nil {
		return SignIn{}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.last
}
