package auth

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"

	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"

	"console/internal/cache"
)

// stubKeySet stands in for the IdP's signing keys. It hands back the payload the
// token carries, which is what the verifier compares against the token it
// parsed itself - enough to get a login past the signature check without a real
// Keycloak behind it.
type stubKeySet struct{}

func (stubKeySet) VerifySignature(_ context.Context, jwt string) ([]byte, error) {
	parts := strings.Split(jwt, ".")
	if len(parts) != 3 {
		return nil, errors.New("not a jwt")
	}
	return base64.RawURLEncoding.DecodeString(parts[1])
}

// unwritableCache is a session store that answers every write with a failure,
// standing in for a Redis that is up enough to be talked to and not enough to
// remember anything.
type unwritableCache struct{}

func (unwritableCache) Get(context.Context, string) ([]byte, bool, error) { return nil, false, nil }
func (unwritableCache) Set(context.Context, string, []byte, time.Duration) error {
	return errors.New("cache is not writable")
}
func (unwritableCache) Delete(context.Context, string) error { return nil }
func (unwritableCache) Ping(context.Context) error           { return nil }
func (unwritableCache) Close()                               {}

var _ cache.Cache = unwritableCache{}

// idToken builds a token the stub key set accepts: three segments, with the
// claims in the middle one. Only the payload is ever read.
func idToken(nonce string) string {
	payload, _ := json.Marshal(map[string]any{
		"iss":   "http://kc/realms/portal",
		"aud":   "portal",
		"sub":   "u1",
		"exp":   time.Now().Add(time.Hour).Unix(),
		"nonce": nonce,
	})
	seg := func(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }
	return seg([]byte(`{"alg":"RS256"}`)) + "." + seg(payload) + "." + seg([]byte("signature"))
}

// tokenEndpoint stands in for Keycloak's /token: it answers the exchange with
// whatever the case under test needs it to.
func tokenEndpoint(t *testing.T, status int, body map[string]any) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(body)
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

// Every reason the sign-in screen has wording for has to be a reason a login
// can actually end in - otherwise the portal has a sentence for a situation
// nobody reaches, and no sentence for the situation they do. The two reasons a
// callback can carry before the exchange (state, provider) are covered by
// TestCallbackFailuresSendTheUserBack; this is the rest of the way through, to
// the point where the session is written.
//
// "start" is the one reason with no test here: it is what the portal answers if
// the system's own random source or JSON encoder fails while a login is being
// begun. There is no way to arrange that from outside, and dropping the reason
// would mean ignoring the failure instead.
func TestLoginFailuresPastTheExchange(t *testing.T) {
	cases := []struct {
		name     string
		status   int
		body     map[string]any
		badToken bool // the token comes back unreadable
		want     string
	}{
		{
			name:   "Keycloak refuses to hand over the tokens",
			status: http.StatusBadRequest,
			body:   map[string]any{"error": "invalid_grant"},
			want:   failExchange,
		},
		{
			name:   "the token response carries no id_token",
			status: http.StatusOK,
			body:   map[string]any{"access_token": "at", "token_type": "Bearer"},
			want:   failIdentity,
		},
		{
			name:     "the id_token does not check out",
			status:   http.StatusOK,
			badToken: true,
			want:     failIdentity,
		},
		{
			// The session store below cannot write, so a login that gets this far
			// is one the portal has verified and then cannot remember.
			name:   "the portal cannot remember the login",
			status: http.StatusOK,
			want:   failSession,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			o := testOIDC()
			o.verifier = oidc.NewVerifier("http://kc/realms/portal", stubKeySet{}, &oidc.Config{
				ClientID: "portal", SkipExpiryCheck: true,
			})
			o.sessions = NewSessionStore(unwritableCache{}, time.Hour, "0123456789abcdef0123456789abcdef")

			state, ck := startLogin(t, o, "/api/v1/auth/login")
			pending, err := decodePendingLogin(ck.Value)
			if err != nil {
				t.Fatalf("the login this test just started is unreadable: %v", err)
			}
			body := c.body
			if body == nil {
				token := idToken(pending.Nonce)
				if c.badToken {
					token = "not-a-token"
				}
				body = map[string]any{"access_token": "at", "token_type": "Bearer", "id_token": token}
			}
			o.oauth.Endpoint.TokenURL = tokenEndpoint(t, c.status, body)

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet,
				fmt.Sprintf("/api/v1/auth/callback?state=%s&code=xyz", url.QueryEscape(state)), nil)
			req.AddCookie(ck)
			o.Callback(rec, req)

			if rec.Code != http.StatusFound {
				t.Fatalf("status = %d, want a redirect back to the portal", rec.Code)
			}
			loc, err := url.Parse(rec.Header().Get("Location"))
			if err != nil {
				t.Fatal(err)
			}
			if got := loc.Query().Get("auth_error"); got != c.want {
				t.Errorf("auth_error = %q, want %q", got, c.want)
			}
		})
	}
}

// The sign-in screen is where every one of these reasons is turned into a
// sentence, and the two halves live in different languages in different files.
// A reason added on one side and forgotten on the other is invisible until
// somebody hits it: a new failure shows the fallback wording, and a reason
// dropped from the portal leaves a sentence nobody will ever read.
func TestSignInScreenHasWordingForEveryReason(t *testing.T) {
	const screen = "../../web/src/components/LoginScreen.tsx"
	src, err := os.ReadFile(screen)
	if err != nil {
		t.Fatalf("read %s: %v", screen, err)
	}
	// The reasons the screen knows, taken from the keys of its LOGIN_ERRORS map.
	block := regexp.MustCompile(`(?s)LOGIN_ERRORS[^{]*\{(.*?)\n\};`).FindSubmatch(src)
	if block == nil {
		t.Fatalf("no LOGIN_ERRORS table in %s", screen)
	}
	onScreen := regexp.MustCompile(`(?m)^  ([a-z_]+): \{`).FindAllSubmatch(block[1], -1)
	var known []string
	for _, m := range onScreen {
		known = append(known, string(m[1]))
	}

	reasons := []string{failStart, failState, failProvider, failExchange, failIdentity, failSession}
	for _, r := range reasons {
		if !slices.Contains(known, r) {
			t.Errorf("the portal can answer a login with %q and the sign-in screen has no wording for it", r)
		}
	}
	for _, k := range known {
		if !slices.Contains(reasons, k) {
			t.Errorf("the sign-in screen explains %q, which no login can end in any more", k)
		}
	}
}
