package auth

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"golang.org/x/oauth2"
)

func testOIDC() *OIDC {
	return &OIDC{
		oauth: oauth2.Config{
			ClientID:    "portal",
			Endpoint:    oauth2.Endpoint{AuthURL: "http://kc:8081/auth"},
			RedirectURL: "http://host/api/v1/auth/callback",
		},
		secure:    true,
		postLogin: "http://portal.local/",
		log:       slog.New(slog.DiscardHandler),
	}
}

// startLogin runs Login and returns the attempt it wrote: the state Keycloak is
// asked to echo back, and the cookie that has to come back with it.
func startLogin(t *testing.T, o *OIDC, target string, carry ...*http.Cookie) (string, *http.Cookie) {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	for _, c := range carry {
		req.AddCookie(c)
	}
	o.Login(rec, req)

	loc, err := url.Parse(rec.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	state := loc.Query().Get("state")
	if state == "" {
		t.Fatalf("no state in the auth URL: %s", rec.Header().Get("Location"))
	}
	for _, ck := range rec.Result().Cookies() {
		if ck.Name == loginCookiePrefix+state && ck.Value != "" {
			return state, ck
		}
	}
	t.Fatalf("login wrote no cookie for state %q: %+v", state, rec.Result().Cookies())
	return "", nil
}

func TestOIDCLoginSetsNonce(t *testing.T) {
	o := testOIDC()
	rec := httptest.NewRecorder()
	o.Login(rec, httptest.NewRequest(http.MethodGet, "/api/v1/auth/login", nil))

	loc, err := url.Parse(rec.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	var pending pendingLogin
	for _, ck := range rec.Result().Cookies() {
		if ck.Name == loginCookiePrefix+loc.Query().Get("state") {
			if pending, err = decodePendingLogin(ck.Value); err != nil {
				t.Fatal(err)
			}
		}
	}
	if pending.Nonce == "" {
		t.Fatal("the login kept no nonce")
	}
	if pending.Verifier == "" {
		t.Fatal("the login kept no PKCE verifier")
	}
	if got := loc.Query().Get("nonce"); got != pending.Nonce {
		t.Fatalf("nonce param = %q, want the one the login kept %q", got, pending.Nonce)
	}
	// PKCE: the auth URL must carry an S256 challenge (not the raw verifier).
	if loc.Query().Get("code_challenge") == "" || loc.Query().Get("code_challenge_method") != "S256" {
		t.Fatalf("missing PKCE S256 challenge in auth URL: %s", loc.RawQuery)
	}
	// The redirect carries this attempt's state; a cached copy of it would send
	// the next login to Keycloak with a state whose cookie is gone.
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", got)
	}
}

// Two tabs starting a login at the same time is the ordinary case, not the
// exotic one: an expired session answers 401 to everything in flight. Neither
// attempt may write over the other, or the login the person finishes comes back
// with a state nobody is waiting for.
func TestParallelLoginsDoNotOverwriteEachOther(t *testing.T) {
	o := testOIDC()
	stateA, cookieA := startLogin(t, o, "/api/v1/auth/login?return_to=/catalog")
	stateB, cookieB := startLogin(t, o, "/api/v1/auth/login?return_to=/orders", cookieA)

	if stateA == stateB {
		t.Fatal("two logins got the same state")
	}
	if cookieA.Name == cookieB.Name {
		t.Fatalf("both logins wrote the cookie %q, so the second erased the first", cookieA.Name)
	}
	// The browser now carries both attempts, and the older one still finishes:
	// the callback for A must not be turned away because B started later.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback?state="+stateA+"&code=xyz", nil)
	req.AddCookie(cookieA)
	req.AddCookie(cookieB)
	o.Callback(rec, req)

	loc, err := url.Parse(rec.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	// The exchange itself cannot happen without a Keycloak here, so the login
	// gets that far and no further. What matters is that it was not turned away
	// as a login this browser never started.
	if got := loc.Query().Get("auth_error"); got == "state" {
		t.Error("the older tab's callback was rejected, though its cookie was still there")
	}
}

// An authorization response is good once. Coming back to the callback URL a
// second time - the back button, a reloaded tab - must not start a session.
func TestCallbackSpendsTheAttempt(t *testing.T) {
	o := testOIDC()
	state, cookie := startLogin(t, o, "/api/v1/auth/login")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback?state="+state+"&code=xyz", nil)
	req.AddCookie(cookie)
	o.Callback(rec, req)

	var cleared bool
	for _, ck := range rec.Result().Cookies() {
		if ck.Name == loginCookiePrefix+state && ck.MaxAge < 0 {
			cleared = true
		}
	}
	if !cleared {
		t.Fatalf("the attempt's cookie outlived its callback: %+v", rec.Result().Cookies())
	}
}

// An abandoned login leaves its cookie behind for the whole login window, and
// the browser sends every one of them with every request. Starting a new login
// drops the oldest.
func TestLoginPrunesAbandonedAttempts(t *testing.T) {
	o := testOIDC()
	var carry []*http.Cookie
	var states []string
	for range maxPendingLogins + 2 {
		state, cookie := startLogin(t, o, "/api/v1/auth/login", carry...)
		carry = append(carry, cookie)
		states = append(states, state)
	}
	// Whatever survived, the newest attempt is among it and the browser is not
	// left carrying every login anyone ever abandoned.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/login", nil)
	for _, c := range carry {
		req.AddCookie(c)
	}
	o.Login(rec, req)

	dropped := 0
	for _, ck := range rec.Result().Cookies() {
		if ck.MaxAge < 0 {
			dropped++
		}
		if ck.Name == loginCookiePrefix+states[len(states)-1] && ck.MaxAge < 0 {
			t.Error("the newest pending login was dropped, not the oldest")
		}
	}
	if want := len(carry) - (maxPendingLogins - 1); dropped != want {
		t.Errorf("dropped %d attempts of %d, want %d", dropped, len(carry), want)
	}
}

func TestSafeReturnTo(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"", ""},
		{"/", "/"},
		{"/orders/123", "/orders/123"},
		{"/orders/123?tab=values", "/orders/123?tab=values"},
		// Open-redirect attempts must be rejected.
		{"//evil.com", ""},
		{"/\\evil.com", ""},
		{"http://evil.com", ""},
		{"https://evil.com", ""},
		{"evil.com", ""},
		{"javascript:alert(1)", ""},
	}
	for _, c := range cases {
		if got := safeReturnTo(c.in); got != c.want {
			t.Errorf("safeReturnTo(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestOIDCLogoutRedirect(t *testing.T) {
	const endSession = "http://kc:8081/realms/internal/protocol/openid-connect/logout"
	const postLogout = "http://host:5173/"

	t.Run("RP-initiated via end_session", func(t *testing.T) {
		o := &OIDC{cookieName: "idp_session", endSession: endSession, postLogout: postLogout}
		rec := httptest.NewRecorder()
		o.Logout(rec, httptest.NewRequest(http.MethodGet, "/api/v1/auth/logout", nil))

		if rec.Code != http.StatusFound {
			t.Fatalf("status = %d, want 302", rec.Code)
		}
		loc := rec.Header().Get("Location")
		if !strings.HasPrefix(loc, endSession) {
			t.Fatalf("Location %q does not target end_session_endpoint", loc)
		}
		u, err := url.Parse(loc)
		if err != nil {
			t.Fatal(err)
		}
		if got := u.Query().Get("post_logout_redirect_uri"); got != postLogout {
			t.Errorf("post_logout_redirect_uri = %q, want %q", got, postLogout)
		}
		// The session cookie must be cleared on the way out.
		if sc := rec.Result().Cookies(); len(sc) == 0 || sc[0].MaxAge >= 0 {
			t.Errorf("session cookie not cleared: %+v", sc)
		}
	})

	t.Run("fallback when IdP has no end_session", func(t *testing.T) {
		o := &OIDC{cookieName: "idp_session", postLogout: postLogout}
		rec := httptest.NewRecorder()
		o.Logout(rec, httptest.NewRequest(http.MethodGet, "/api/v1/auth/logout", nil))

		if rec.Code != http.StatusFound {
			t.Fatalf("status = %d, want 302", rec.Code)
		}
		if loc := rec.Header().Get("Location"); loc != postLogout {
			t.Errorf("Location = %q, want %q", loc, postLogout)
		}
	})
}

func TestResolveReturn(t *testing.T) {
	cases := []struct {
		postLogin string
		rt        string
		want      string
	}{
		// Split-origin dev: return-to path must land on the SPA origin, not the
		// API origin the callback runs on.
		{"http://10.10.100.33:5173/", "/", "http://10.10.100.33:5173/"},
		{"http://10.10.100.33:5173/", "/orders/123", "http://10.10.100.33:5173/orders/123"},
		{"http://host:5173/", "/orders/123?tab=values", "http://host:5173/orders/123?tab=values"},
		// Single-origin prod: relative postLogin keeps the path relative.
		{"/", "/orders/123", "/orders/123"},
		{"", "/orders/123", "/orders/123"},
	}
	for _, c := range cases {
		if got := resolveReturn(c.postLogin, c.rt); got != c.want {
			t.Errorf("resolveReturn(%q, %q) = %q, want %q", c.postLogin, c.rt, got, c.want)
		}
	}
}

// A login that cannot be completed used to end on a bare "invalid state" page:
// a dead end, with nothing on it to press and nothing to understand. It now
// ends where the login started, with the reason attached, so the sign-in screen
// can say what happened next to the button that tries again.
func TestCallbackFailuresSendTheUserBack(t *testing.T) {
	cases := []struct {
		name  string
		query string
		state string // the attempt this browser still carries, if any
		want  string
	}{
		{"the cookie is gone, or was never this browser's", "?state=abc&code=xyz", "", "state"},
		{"the callback belongs to another login", "?state=abc&code=xyz", "another", "state"},
		{"the callback carries no state at all", "?code=xyz", "abc", "state"},
		{"Keycloak refused", "?error=access_denied&error_description=user+cancelled", "abc", "provider"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			o := &OIDC{postLogin: "http://portal.local/", log: slog.New(slog.DiscardHandler)}
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback"+c.query, nil)
			if c.state != "" {
				req.AddCookie(&http.Cookie{Name: loginCookiePrefix + c.state, Value: "irrelevant"})
			}
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
			if loc.Host != "portal.local" {
				t.Errorf("sent to %q, want the portal itself", loc)
			}
		})
	}
}

// The cookies that carry a login in progress have to outlive the time a person
// spends at the Keycloak form: typing a password, a second factor, a reset in
// the middle of it. Five minutes did not, and the login came back as a failure
// nobody could act on.
func TestLoginWindowOutlastsTheKeycloakForm(t *testing.T) {
	o := &OIDC{oauth: oauth2.Config{Endpoint: oauth2.Endpoint{AuthURL: "http://kc:8081/auth"}}}
	rec := httptest.NewRecorder()
	o.Login(rec, httptest.NewRequest(http.MethodGet, "/api/v1/auth/login?return_to=/catalog", nil))

	const atLeast = 10 * 60
	for _, ck := range rec.Result().Cookies() {
		if !strings.HasPrefix(ck.Name, "oauth_") {
			continue
		}
		if ck.MaxAge < atLeast {
			t.Errorf("%s lives %ds, too short for a person at the login form", ck.Name, ck.MaxAge)
		}
	}
}

func TestWithParam(t *testing.T) {
	cases := []struct{ dest, want string }{
		{"/", "/?auth_error=state"},
		{"http://portal.local/", "http://portal.local/?auth_error=state"},
		{"http://portal.local/?tab=values", "http://portal.local/?auth_error=state&tab=values"},
	}
	for _, c := range cases {
		if got := withParam(c.dest, "auth_error", "state"); got != c.want {
			t.Errorf("withParam(%q) = %q, want %q", c.dest, got, c.want)
		}
	}
}
