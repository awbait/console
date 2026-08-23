package auth

import (
	"cmp"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
	"console/pkg/models"
)

// OIDC authenticates via Keycloak Authorization Code flow (with PKCE) and keeps
// server-side sessions in Redis. Access tokens are silently refreshed.
type OIDC struct {
	provider   *oidc.Provider
	verifier   *oidc.IDTokenVerifier
	oauth      oauth2.Config
	sessions   *SessionStore
	rbac       RBAC
	cookieName string
	secure     bool
	sessionTTL time.Duration // session cookie MaxAge, aligned with the server session
	postLogin  string
	postLogout string
	endSession string // Keycloak end_session_endpoint (RP-initiated logout)
	log        *slog.Logger
	// SignIns remembers what the last successful sign-in carried, so the status
	// page can tell a realm that sends the group claim from one that does not.
	// Optional: nil records nothing.
	SignIns *SignIns
}

var _ Authenticator = (*OIDC)(nil)

// OIDCConfig configures the OIDC authenticator.
type OIDCConfig struct {
	Issuer       string
	ClientID     string
	ClientSecret string
	RedirectURL  string
	Scopes       []string
	CookieName   string
	Secure       bool
	// SessionTTL sets the session cookie MaxAge so its lifetime matches the
	// server-side session (instead of a browser-session cookie that outlives or
	// underlives it).
	SessionTTL time.Duration
	// Where to send the browser after a successful login (default "/").
	PostLogin string
	// Where to send the browser after logout. Must be registered as a valid
	// post-logout redirect URI on the Keycloak client. Defaults to PostLogin.
	PostLogout string
	// Log receives the reason a login did not go through. The person gets a
	// category on screen; this is where the detail behind it goes, and without
	// it a deployment where every login fails looks exactly like one where
	// nobody has tried.
	Log *slog.Logger
}

// NewOIDC discovers the issuer and builds the authenticator.
func NewOIDC(ctx context.Context, c OIDCConfig, sessions *SessionStore, rbac RBAC) (*OIDC, error) {
	provider, err := oidc.NewProvider(ctx, c.Issuer)
	if err != nil {
		return nil, err
	}
	// end_session_endpoint is not part of go-oidc's typed Endpoint(); pull it
	// from the raw discovery document for RP-initiated logout.
	var disc struct {
		EndSession string `json:"end_session_endpoint"`
	}
	_ = provider.Claims(&disc)
	return &OIDC{
		provider: provider,
		verifier: provider.Verifier(&oidc.Config{ClientID: c.ClientID}),
		oauth: oauth2.Config{
			ClientID:     c.ClientID,
			ClientSecret: c.ClientSecret,
			Endpoint:     provider.Endpoint(),
			RedirectURL:  c.RedirectURL,
			Scopes:       c.Scopes,
		},
		sessions:   sessions,
		rbac:       rbac,
		cookieName: c.CookieName,
		secure:     c.Secure,
		sessionTTL: c.SessionTTL,
		postLogin:  cmp.Or(c.PostLogin, "/"),
		postLogout: cmp.Or(c.PostLogout, c.PostLogin, "/"),
		endSession: disc.EndSession,
		log:        c.Log,
	}, nil
}

type claims struct {
	Email    string   `json:"email"`
	Username string   `json:"preferred_username"`
	Name     string   `json:"name"`
	Groups   []string `json:"groups"`
}

// randState returns a cryptographically random URL-safe token (for state/nonce).
// A rand failure must fail the login rather than proceed with a predictable value.
func randState() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// safeReturnTo returns p if it is a safe same-origin relative path, else "".
// Guards against open-redirect: the path must start with a single "/" and must
// not begin with "//" or "/\" (which browsers treat as protocol-relative URLs).
func safeReturnTo(p string) string {
	if p == "" || p[0] != '/' {
		return ""
	}
	if len(p) > 1 && (p[1] == '/' || p[1] == '\\') {
		return ""
	}
	return p
}

// resolveReturn places the validated return-to path on the same origin as the
// post-login base. In split-origin dev (callback served on the API host, SPA on
// the Vite host) a bare relative path would otherwise resolve against the API
// origin, which does not serve the SPA. When postLogin is itself relative
// (single-origin prod) the path is returned unchanged. rt is assumed already
// validated by safeReturnTo, so the origin is always taken from trusted config.
func resolveReturn(postLogin, rt string) string {
	base, err := url.Parse(postLogin)
	if err != nil || !base.IsAbs() {
		return rt
	}
	ref, err := url.Parse(rt)
	if err != nil {
		return rt
	}
	return base.ResolveReference(ref).String()
}

// Why a login did not go through. The browser is sent back to the sign-in
// screen with one of these on the query string, and the screen turns it into a
// sentence a person can act on. A code is a category and never a detail: what
// exactly happened goes to the log, where it is useful and where it cannot be
// read by whoever arranged the failure.
const (
	failStart    = "start"    // the login could not even be begun
	failState    = "state"    // the login this callback belongs to cannot be recognised
	failProvider = "provider" // Keycloak itself refused (declined, cancelled, no access)
	failExchange = "exchange" // Keycloak did not hand over the tokens
	failIdentity = "identity" // the tokens did not check out (signature, nonce, claims)
	failSession  = "session"  // the portal could not remember the login
)

// loginWindow is how long the cookie that carries a login in progress lives:
// the nonce, the PKCE verifier and where to return to. It has to cover
// the whole time the person spends at Keycloak, and that is not a moment - a
// password typed slowly, a second factor, a password reset in the middle of it.
// Five minutes turned out to be short enough that ordinary logins fell out of
// the window and came back as "invalid state", which is a failure the person
// could do nothing about and could not understand.
const loginWindow = int(15 * time.Minute / time.Second)

// A login in progress belongs to an attempt, not to the browser. The portal has
// several requests in the air at any moment - who am I, what is healthy, how
// many unread - and when the session expires they all come back 401 at once, in
// every open tab. With one fixed set of cookie names the second attempt to
// start a login wrote its state over the first one's, and the login the person
// actually finished came back carrying a state nobody was waiting for any more:
// "sign-in not completed", on a login that was going perfectly well.
//
// So the state goes into the cookie name and everything else the attempt needs
// into its value. Two attempts write two different cookies and neither disturbs
// the other. Finding the cookie named after the state Keycloak echoed back is
// what proves the callback belongs to a login this browser started - the same
// thing comparing two values used to prove, the state being unguessable either
// way.
const loginCookiePrefix = "oauth_login_"

// maxPendingLogins bounds how many unfinished attempts a browser carries at
// once: each one is a cookie sent with every request, and a login is abandoned
// far more often than it is finished - a tab closed at the Keycloak form leaves
// one behind for the whole login window. Past the limit the oldest are dropped,
// as the least likely to still be waiting for their callback.
const maxPendingLogins = 4

// pendingLogin is what the callback needs to finish an attempt that the
// redirect to Keycloak left behind: the nonce the id_token has to carry, the
// PKCE verifier, and where the person was going.
type pendingLogin struct {
	Nonce    string `json:"n"`
	Verifier string `json:"v"`
	ReturnTo string `json:"r,omitempty"`
	// Issued is when the attempt started, in milliseconds: it only decides which
	// attempt to drop first, and logins started from different tabs at the same
	// 401 are a fraction of a second apart.
	Issued int64 `json:"t"`
}

// encode packs an attempt into one cookie value. Base64 so that arbitrary path
// characters in the return-to survive cookie sanitization.
func (p pendingLogin) encode() (string, error) {
	b, err := json.Marshal(p)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func decodePendingLogin(v string) (pendingLogin, error) {
	var p pendingLogin
	b, err := base64.RawURLEncoding.DecodeString(v)
	if err != nil {
		return p, err
	}
	return p, json.Unmarshal(b, &p)
}

// setPendingLogin writes an attempt's cookie. Lax, because it has to survive
// the top-level navigation back from Keycloak, and short-lived, so an abandoned
// attempt does not linger.
func (o *OIDC) setPendingLogin(w http.ResponseWriter, state, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name: loginCookiePrefix + state, Value: value, Path: "/", HttpOnly: true,
		Secure: o.secure, SameSite: http.SameSiteLaxMode, MaxAge: maxAge,
	})
}

func (o *OIDC) clearPendingLogin(w http.ResponseWriter, state string) {
	o.setPendingLogin(w, state, "", -1)
}

// prunePendingLogins expires the oldest attempts the browser still carries, to
// leave room for the one about to start.
func (o *OIDC) prunePendingLogins(w http.ResponseWriter, r *http.Request) {
	type attempt struct {
		state  string
		issued int64
		seen   int // position in the cookie header, see the sort below
	}
	var pending []attempt
	for i, c := range r.Cookies() {
		if !strings.HasPrefix(c.Name, loginCookiePrefix) {
			continue
		}
		state := strings.TrimPrefix(c.Name, loginCookiePrefix)
		p, err := decodePendingLogin(c.Value)
		if err != nil {
			// Unreadable: it will never finish a login, so there is no reason to
			// keep sending it.
			o.clearPendingLogin(w, state)
			continue
		}
		pending = append(pending, attempt{state: state, issued: p.Issued, seen: i})
	}
	// Newest first. Two attempts started in the same millisecond are told apart
	// by the order the browser sends them in: that is roughly the order they
	// were set, and it is the only hint there is.
	slices.SortFunc(pending, func(a, b attempt) int {
		if c := cmp.Compare(b.issued, a.issued); c != 0 {
			return c
		}
		return cmp.Compare(b.seen, a.seen)
	})
	for _, a := range pending[min(len(pending), maxPendingLogins-1):] {
		o.clearPendingLogin(w, a.state)
	}
}

// noStore keeps a login response out of every cache between here and the
// browser. The redirect to Keycloak carries this attempt's state in Location,
// and the callback response carries the session cookie: a reused copy of either
// is a login that cannot be finished at best.
func noStore(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
}

// failLogin sends the browser back to the sign-in screen with the reason
// attached, instead of leaving it on a bare error page. Every one of these ends
// the same way for the person: start the login again - and the button that does
// that is on the screen they are now looking at.
func (o *OIDC) failLogin(w http.ResponseWriter, r *http.Request, reason string, err error) {
	o.logger().Warn("login failed", "reason", reason, "err", err)
	noStore(w)
	http.Redirect(w, r, withParam(o.postLogin, "auth_error", reason), http.StatusFound)
}

func (o *OIDC) logger() *slog.Logger {
	if o.log != nil {
		return o.log
	}
	return slog.Default()
}

// withParam adds a query parameter to a destination that may be a bare path or
// an absolute URL (split-origin dev), keeping whatever it already carries.
func withParam(dest, key, value string) string {
	u, err := url.Parse(dest)
	if err != nil {
		return "/?" + url.Values{key: {value}}.Encode()
	}
	q := u.Query()
	q.Set(key, value)
	u.RawQuery = q.Encode()
	return u.String()
}

func (o *OIDC) Login(w http.ResponseWriter, r *http.Request) {
	state, err := randState()
	if err != nil {
		o.failLogin(w, r, failStart, err)
		return
	}
	// nonce binds the id_token to this login (replay/injection defence). Kept
	// with the attempt and verified against idToken.Nonce on callback.
	nonce, err := randState()
	if err != nil {
		o.failLogin(w, r, failStart, err)
		return
	}
	// PKCE: bind the auth code to this client via a one-time verifier (defence in
	// depth even for a confidential client). Only its S256 challenge goes to the
	// IdP.
	verifier := oauth2.GenerateVerifier()
	// Where to return afterwards is validated here and again on the way back.
	value, err := pendingLogin{
		Nonce:    nonce,
		Verifier: verifier,
		ReturnTo: safeReturnTo(r.URL.Query().Get("return_to")),
		Issued:   time.Now().UnixMilli(),
	}.encode()
	if err != nil {
		o.failLogin(w, r, failStart, err)
		return
	}
	o.prunePendingLogins(w, r)
	o.setPendingLogin(w, state, value, loginWindow)
	noStore(w)
	http.Redirect(w, r,
		o.oauth.AuthCodeURL(state, oidc.Nonce(nonce), oauth2.S256ChallengeOption(verifier)),
		http.StatusFound)
}

func (o *OIDC) Callback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	// Keycloak can answer the login with a refusal instead of a code (the person
	// cancelled, the account is not allowed in, consent was denied). Its own
	// wording is not repeated on our page - it is text from elsewhere, and the
	// person is told what to do about it instead.
	if e := r.URL.Query().Get("error"); e != "" {
		o.failLogin(w, r, failProvider, fmt.Errorf("%s: %s", e, r.URL.Query().Get("error_description")))
		return
	}
	// The cookie named after the state is what ties this callback to a login this
	// browser started. No such cookie means the login is not this browser's, or
	// is old enough that the cookie is gone, or it has already been finished
	// once. All the same story for the person: this login cannot be finished,
	// start it again.
	state := r.URL.Query().Get("state")
	if state == "" {
		o.failLogin(w, r, failState, errors.New("the callback carries no state"))
		return
	}
	stateCookie, err := r.Cookie(loginCookiePrefix + state)
	if err != nil || stateCookie.Value == "" {
		o.failLogin(w, r, failState, err)
		return
	}
	pending, err := decodePendingLogin(stateCookie.Value)
	// The attempt is spent either way: an authorization response is good once,
	// and leaving the state alive would let this callback be replayed until the
	// login window ran out.
	o.clearPendingLogin(w, state)
	if err != nil {
		o.failLogin(w, r, failState, err)
		return
	}
	// Complete PKCE with the verifier this attempt kept.
	oauth2Token, err := o.oauth.Exchange(ctx, r.URL.Query().Get("code"),
		oauth2.VerifierOption(pending.Verifier))
	if err != nil {
		o.failLogin(w, r, failExchange, err)
		return
	}
	rawID, ok := oauth2Token.Extra("id_token").(string)
	if !ok {
		o.failLogin(w, r, failIdentity, errors.New("no id_token in the token response"))
		return
	}
	idToken, err := o.verifier.Verify(ctx, rawID)
	if err != nil {
		o.failLogin(w, r, failIdentity, err)
		return
	}
	// Bind the id_token to this browser's login: its nonce must match the one
	// this attempt started with. Defeats id_token replay/injection.
	if pending.Nonce == "" || idToken.Nonce != pending.Nonce {
		o.failLogin(w, r, failIdentity, errors.New("id_token nonce does not match the login"))
		return
	}
	var cl claims
	if err := idToken.Claims(&cl); err != nil {
		o.failLogin(w, r, failIdentity, err)
		return
	}
	// Re-login from a browser that still holds a session cookie: drop the old
	// server-side session so stale sessions do not accumulate until their TTL.
	if old, oerr := r.Cookie(o.cookieName); oerr == nil && old.Value != "" {
		_ = o.sessions.Delete(ctx, old.Value)
	}
	user := o.rbac.BuildUser(idToken.Subject, cl.Email, cl.Username, cl.Name, cl.Groups)
	sess := &Session{
		User:         user,
		AccessToken:  oauth2Token.AccessToken,
		RefreshToken: oauth2Token.RefreshToken,
		IDToken:      rawID,
		Expiry:       oauth2Token.Expiry,
	}
	id, err := o.sessions.Create(ctx, sess)
	if err != nil {
		o.failLogin(w, r, failSession, err)
		return
	}
	o.SignIns.Record(len(cl.Groups), len(user.Teams), string(user.Role))
	// SameSite=Strict on the session cookie: it is never needed on a cross-site
	// top-level navigation (the OAuth callback only sets it, the oauth_* cookies
	// that must survive the Keycloak redirect stay Lax). Strict also defeats the
	// cross-site forced-logout (the cookie is not sent to a third-party-initiated
	// GET /logout). MaxAge aligns the cookie lifetime with the server session.
	http.SetCookie(w, &http.Cookie{
		Name: o.cookieName, Value: id, Path: "/", HttpOnly: true,
		Secure: o.secure, SameSite: http.SameSiteStrictMode, MaxAge: int(o.sessionTTL.Seconds()),
	})
	dest := o.postLogin
	if rt := safeReturnTo(pending.ReturnTo); rt != "" {
		dest = resolveReturn(o.postLogin, rt)
	}
	noStore(w)
	http.Redirect(w, r, dest, http.StatusFound)
}

func (o *OIDC) Authenticate(r *http.Request) (*models.User, error) {
	c, err := r.Cookie(o.cookieName)
	if err != nil || c.Value == "" {
		return nil, ErrUnauthenticated
	}
	sess, err := o.sessions.Get(r.Context(), c.Value)
	if err != nil {
		return nil, ErrUnauthenticated
	}
	// Silent refresh: if the access token expired and we have a refresh token,
	// refresh and persist. On failure, force re-login.
	if !sess.Expiry.IsZero() && time.Now().After(sess.Expiry) && sess.RefreshToken != "" {
		ts := o.oauth.TokenSource(r.Context(), &oauth2.Token{RefreshToken: sess.RefreshToken})
		newTok, err := ts.Token()
		if err != nil {
			_ = o.sessions.Delete(r.Context(), c.Value)
			return nil, ErrUnauthenticated
		}
		sess.AccessToken = newTok.AccessToken
		sess.Expiry = newTok.Expiry
		if newTok.RefreshToken != "" {
			// Persist the rotated refresh token; the IdP invalidates the old one
			// after first use, so dropping it here would break the next refresh.
			sess.RefreshToken = newTok.RefreshToken
		}
		// Re-derive identity and roles from the refreshed id_token so a revoked
		// group or a disabled account takes effect at refresh time, not only at the
		// next full login (otherwise stale privileges linger for the whole session).
		if rawID, ok := newTok.Extra("id_token").(string); ok && rawID != "" {
			idToken, verr := o.verifier.Verify(r.Context(), rawID)
			if verr != nil {
				// The IdP no longer vouches for this identity - force re-login
				// rather than serving the stale user.
				_ = o.sessions.Delete(r.Context(), c.Value)
				return nil, ErrUnauthenticated
			}
			var cl claims
			if idToken.Claims(&cl) == nil {
				sess.User = o.rbac.BuildUser(idToken.Subject, cl.Email, cl.Username, cl.Name, cl.Groups)
				sess.IDToken = rawID
			}
		}
		// Persist the rotated tokens and extend the session TTL. Best-effort: a
		// store error must not fail an otherwise-authenticated request.
		_ = o.sessions.Save(r.Context(), c.Value, sess)
	}
	return sess.User, nil
}

// Logout is a browser-navigated GET: it drops the local session and cookie,
// then bounces through Keycloak's end_session_endpoint so the SSO session dies
// too (otherwise a fresh login would silently re-authenticate). Falls back to a
// plain redirect when the IdP advertises no end_session_endpoint.
func (o *OIDC) Logout(w http.ResponseWriter, r *http.Request) {
	var idToken string
	if c, err := r.Cookie(o.cookieName); err == nil && c.Value != "" {
		if sess, gerr := o.sessions.Get(r.Context(), c.Value); gerr == nil {
			idToken = sess.IDToken
		}
		_ = o.sessions.Delete(r.Context(), c.Value)
	}
	http.SetCookie(w, &http.Cookie{
		Name: o.cookieName, Value: "", Path: "/", HttpOnly: true,
		Secure: o.secure, SameSite: http.SameSiteStrictMode, MaxAge: -1,
	})
	if o.endSession == "" {
		http.Redirect(w, r, o.postLogout, http.StatusFound)
		return
	}
	u, err := url.Parse(o.endSession)
	if err != nil {
		http.Redirect(w, r, o.postLogout, http.StatusFound)
		return
	}
	q := u.Query()
	if idToken != "" {
		q.Set("id_token_hint", idToken)
	}
	if o.postLogout != "" {
		q.Set("post_logout_redirect_uri", o.postLogout)
	}
	u.RawQuery = q.Encode()
	http.Redirect(w, r, u.String(), http.StatusFound)
}
