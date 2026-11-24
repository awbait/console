package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"console/internal/cache"
	"console/pkg/models"
	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/go-jose/go-jose/v4"
	"github.com/modelcontextprotocol/go-sdk/oauthex"
)

type fakeIdP struct {
	srv           *httptest.Server
	key           *rsa.PrivateKey
	userInfoHits  atomic.Int64
	userInfoReply claims
}

func newFakeIdP(t *testing.T) *fakeIdP {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate rsa key: %v", err)
	}
	idp := &fakeIdP{key: key}
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"issuer":                                idp.srv.URL,
			"jwks_uri":                              idp.srv.URL + "/jwks",
			"userinfo_endpoint":                     idp.srv.URL + "/userinfo",
			"authorization_endpoint":                idp.srv.URL + "/auth",
			"token_endpoint":                        idp.srv.URL + "/token",
			"id_token_signing_alg_values_supported": []string{"RS256"},
		})
	})
	mux.HandleFunc("/jwks", func(w http.ResponseWriter, _ *http.Request) {
		jwk := jose.JSONWebKey{Key: &key.PublicKey, KeyID: "test-key", Algorithm: string(jose.RS256), Use: "sig"}
		_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{jwk}})
	})
	mux.HandleFunc("/userinfo", func(w http.ResponseWriter, _ *http.Request) {
		idp.userInfoHits.Add(1)
		_ = json.NewEncoder(w).Encode(idp.userInfoReply)
	})
	idp.srv = httptest.NewServer(mux)
	t.Cleanup(idp.srv.Close)
	return idp
}

func (f *fakeIdP) signJWT(t *testing.T, payload map[string]any) string {
	t.Helper()
	signer, err := jose.NewSigner(
		jose.SigningKey{Algorithm: jose.RS256, Key: f.key},
		(&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", "test-key"),
	)
	if err != nil {
		t.Fatalf("new signer: %v", err)
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	jws, err := signer.Sign(raw)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	compact, err := jws.CompactSerialize()
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	return compact
}

func TestBearerVerifierValidatesTokenAndRBAC(t *testing.T) {
	ctx := context.Background()
	idp := newFakeIdP(t)
	rbac := RBAC{
		AdminGroups:    []string{"platform-admins"},
		SupportGroups:  []string{"support"},
		SecurityGroups: []string{"security"},
		TeamPrefix:     "team-",
	}
	verifier, err := NewBearerVerifier(ctx, BearerConfig{
		Issuer:   idp.srv.URL,
		Audience: "portal-mcp",
	}, cache.NewMemory(), rbac)
	if err != nil {
		t.Fatalf("new bearer verifier: %v", err)
	}

	now := time.Now()
	tok := idp.signJWT(t, map[string]any{
		"iss":                idp.srv.URL,
		"sub":                "user-1",
		"aud":                []string{"portal-mcp", "account"},
		"exp":                now.Add(5 * time.Minute).Unix(),
		"iat":                now.Unix(),
		"email":              "alice@example.com",
		"preferred_username": "alice",
		"name":               "Alice Dev",
		"groups":             []string{"/team-core", "/team-payments"},
	})

	req := httptest.NewRequest(http.MethodPost, "/mcp", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	u, err := verifier.Authenticate(req)
	if err != nil {
		t.Fatalf("authenticate: %v", err)
	}
	if u.Subject != "user-1" || u.Role != models.RoleMember || len(u.Teams) != 2 {
		t.Fatalf("unexpected user: %+v", u)
	}
	if idp.userInfoHits.Load() != 0 {
		t.Fatalf("userinfo should not be called when groups claim is present, got %d hits", idp.userInfoHits.Load())
	}

	// Wrong audience is rejected.
	wrongAud := idp.signJWT(t, map[string]any{
		"iss": idp.srv.URL,
		"sub": "user-1",
		"aud": "other-client",
		"exp": now.Add(5 * time.Minute).Unix(),
	})
	reqBad := httptest.NewRequest(http.MethodPost, "/mcp", nil)
	reqBad.Header.Set("Authorization", "Bearer "+wrongAud)
	if _, err := verifier.Authenticate(reqBad); err == nil {
		t.Fatal("want error for wrong audience")
	}

	// Expired token is rejected.
	expired := idp.signJWT(t, map[string]any{
		"iss": idp.srv.URL,
		"sub": "user-1",
		"aud": "portal-mcp",
		"exp": now.Add(-1 * time.Minute).Unix(),
	})
	reqExp := httptest.NewRequest(http.MethodPost, "/mcp", nil)
	reqExp.Header.Set("Authorization", "Bearer "+expired)
	if _, err := verifier.Authenticate(reqExp); err == nil {
		t.Fatal("want error for expired token")
	}
}

func TestBearerVerifierUserInfoFallbackCached(t *testing.T) {
	ctx := context.Background()
	idp := newFakeIdP(t)
	idp.userInfoReply = claims{
		Email:    "padmin@example.com",
		Username: "padmin",
		Name:     "Platform Admin",
		Groups:   []string{"platform-admins"},
	}
	rbac := RBAC{AdminGroups: []string{"platform-admins"}, TeamPrefix: "team-"}
	prov, err := oidc.NewProvider(ctx, idp.srv.URL)
	if err != nil {
		t.Fatalf("provider: %v", err)
	}
	verifier, err := NewBearerVerifier(ctx, BearerConfig{
		Provider: prov,
		Audience: "portal-mcp",
	}, cache.NewMemory(), rbac)
	if err != nil {
		t.Fatalf("new bearer verifier: %v", err)
	}

	now := time.Now()
	// Token intentionally omits the "groups" claim.
	tok := idp.signJWT(t, map[string]any{
		"iss": idp.srv.URL,
		"sub": "admin-1",
		"aud": "portal-mcp",
		"exp": now.Add(5 * time.Minute).Unix(),
	})

	for i := range 2 {
		req := httptest.NewRequest(http.MethodPost, "/mcp", nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		u, err := verifier.Authenticate(req)
		if err != nil {
			t.Fatalf("call %d: %v", i, err)
		}
		if !u.IsAdmin() || u.Name != "Platform Admin" {
			t.Fatalf("call %d: unexpected user %+v", i, u)
		}
	}
	if hits := idp.userInfoHits.Load(); hits != 1 {
		t.Fatalf("want 1 cached userinfo hit, got %d", hits)
	}
}

func TestBearerMiddlewareChallengeAndProtectedResource(t *testing.T) {
	metaURL := "https://mcp.console.internal/.well-known/oauth-protected-resource"
	mw := BearerMiddleware(NewDev(), metaURL)
	called := false
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if UserFrom(r.Context()) == nil {
			t.Error("expected user in context")
		}
		w.WriteHeader(http.StatusOK)
	}))

	// Unauthenticated: 401 with RFC 9728 WWW-Authenticate header.
	failAuth := BearerMiddleware(funcAuth(func(*http.Request) (*models.User, error) {
		return nil, ErrUnauthenticated
	}), metaURL)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	rec := httptest.NewRecorder()
	failAuth.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/mcp", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	wantHdr := `Bearer resource_metadata="` + metaURL + `"`
	if got := rec.Header().Get("WWW-Authenticate"); got != wantHdr {
		t.Fatalf("WWW-Authenticate = %q, want %q", got, wantHdr)
	}

	// Authenticated passes through.
	recOK := httptest.NewRecorder()
	h.ServeHTTP(recOK, httptest.NewRequest(http.MethodPost, "/mcp", nil))
	if !called || recOK.Code != http.StatusOK {
		t.Fatalf("expected authenticated pass-through: called=%v status=%d", called, recOK.Code)
	}

	// Protected Resource Metadata endpoint.
	prm := ProtectedResourceHandler(oauthex.ProtectedResourceMetadata{
		Resource:               "https://mcp.console.internal/mcp",
		AuthorizationServers:   []string{"https://kc.internal/realms/internal"},
		BearerMethodsSupported: []string{"header"},
		ScopesSupported:        []string{"openid", "profile", "email", "groups"},
	})
	recMeta := httptest.NewRecorder()
	prm.ServeHTTP(recMeta, httptest.NewRequest(http.MethodGet, "/.well-known/oauth-protected-resource", nil))
	if recMeta.Code != http.StatusOK {
		t.Fatalf("metadata status = %d, want 200", recMeta.Code)
	}
	var gotMeta oauthex.ProtectedResourceMetadata
	if err := json.NewDecoder(recMeta.Body).Decode(&gotMeta); err != nil {
		t.Fatalf("decode metadata: %v", err)
	}
	if gotMeta.Resource != "https://mcp.console.internal/mcp" || len(gotMeta.AuthorizationServers) != 1 {
		t.Fatalf("unexpected metadata: %+v", gotMeta)
	}
}

func TestOriginGuard(t *testing.T) {
	guard := OriginGuard([]string{"https://mcp.console.internal", "http://localhost:8090/"})(
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	// No Origin header (CLI/IDE client) is allowed.
	rec := httptest.NewRecorder()
	guard.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/mcp", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("missing origin: status = %d, want 200", rec.Code)
	}

	// Allowed origin passes (case-insensitive).
	rec = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/mcp", nil)
	req.Header.Set("Origin", "HTTPS://MCP.CONSOLE.INTERNAL")
	guard.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("allowed origin: status = %d, want 200", rec.Code)
	}

	// Foreign origin is rejected with 403.
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/mcp", nil)
	req.Header.Set("Origin", "https://evil.example")
	guard.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "forbidden_origin") {
		t.Fatalf("foreign origin: status=%d body=%s", rec.Code, rec.Body.String())
	}
}

type funcAuth func(*http.Request) (*models.User, error)

func (f funcAuth) Authenticate(r *http.Request) (*models.User, error) { return f(r) }
