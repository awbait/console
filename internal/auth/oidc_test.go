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

func TestOIDCLoginSetsNonce(t *testing.T) {
	o := &OIDC{
		oauth: oauth2.Config{
			ClientID:    "portal",
			Endpoint:    oauth2.Endpoint{AuthURL: "http://kc:8081/auth"},
			RedirectURL: "http://host/api/v1/auth/callback",
		},
		secure: true,
	}
	rec := httptest.NewRecorder()
	o.Login(rec, httptest.NewRequest(http.MethodGet, "/api/v1/auth/login", nil))

	var nonceCookie, verifierCookie string
	for _, ck := range rec.Result().Cookies() {
		switch ck.Name {
		case "oauth_nonce":
			nonceCookie = ck.Value
		case "oauth_verifier":
			verifierCookie = ck.Value
		}
	}
	if nonceCookie == "" {
		t.Fatal("oauth_nonce cookie not set")
	}
	if verifierCookie == "" {
		t.Fatal("oauth_verifier (PKCE) cookie not set")
	}
	loc, err := url.Parse(rec.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if got := loc.Query().Get("nonce"); got != nonceCookie {
		t.Fatalf("nonce param = %q, want cookie value %q", got, nonceCookie)
	}
	// PKCE: the auth URL must carry an S256 challenge (not the raw verifier).
	if loc.Query().Get("code_challenge") == "" || loc.Query().Get("code_challenge_method") != "S256" {
		t.Fatalf("missing PKCE S256 challenge in auth URL: %s", loc.RawQuery)
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
		name   string
		query  string
		cookie string // the oauth_state this browser carries, if any
		want   string
	}{
		{"the cookie is gone, or was never this browser's", "?state=abc&code=xyz", "", "state"},
		{"the callback belongs to another login", "?state=abc&code=xyz", "another", "state"},
		{"Keycloak refused", "?error=access_denied&error_description=user+cancelled", "abc", "provider"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			o := &OIDC{postLogin: "http://portal.local/", log: slog.New(slog.DiscardHandler)}
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback"+c.query, nil)
			if c.cookie != "" {
				req.AddCookie(&http.Cookie{Name: "oauth_state", Value: c.cookie})
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
