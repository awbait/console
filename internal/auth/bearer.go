package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"console/internal/cache"
	"console/pkg/models"
	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/modelcontextprotocol/go-sdk/oauthex"
	"golang.org/x/oauth2"
)

// RequestAuthenticator authenticates an HTTP request into a portal user.
// Session-based OIDC authenticators, Bearer JWT verifiers, and future PAT
// authenticators all satisfy this interface.
type RequestAuthenticator interface {
	Authenticate(r *http.Request) (*models.User, error)
}

// tokenVerifier is the narrow slice of go-oidc's IDTokenVerifier needed to
// verify a JWT access token (signature, issuer, expiry, audience).
type tokenVerifier interface {
	Verify(ctx context.Context, rawToken string) (*oidc.IDToken, error)
}

// BearerConfig configures JWT Bearer verification against an OIDC provider.
type BearerConfig struct {
	// Provider is an already-discovered OIDC provider (reused from auth.OIDC).
	// When nil, NewBearerVerifier discovers Issuer directly.
	Provider *oidc.Provider
	Issuer   string
	// Audience is the expected aud claim. Required: empty fails setup so
	// audience verification is never silently skipped.
	Audience string
	// UserInfoTTL caches userinfo lookups when groups are not carried inside
	// the JWT access token. Defaults to 60 seconds.
	UserInfoTTL time.Duration
	Log         *slog.Logger
}

// BearerVerifier authenticates OAuth 2.1 Bearer JWT access tokens issued by
// Keycloak and maps their claims into a portal models.User via RBAC.
type BearerVerifier struct {
	verifier      tokenVerifier
	rbac          RBAC
	cache         cache.Cache
	userInfoTTL   time.Duration
	log           *slog.Logger
	fetchUserInfo func(ctx context.Context, rawToken string) (claims, error)
}

var _ RequestAuthenticator = (*BearerVerifier)(nil)

const defaultUserInfoCacheTTL = 60 * time.Second

// NewBearerVerifier builds a Bearer JWT verifier using the provider's JWKS.
func NewBearerVerifier(ctx context.Context, cfg BearerConfig, c cache.Cache, rbac RBAC) (*BearerVerifier, error) {
	if strings.TrimSpace(cfg.Audience) == "" {
		return nil, errors.New("auth: bearer verifier requires a non-empty audience")
	}
	prov := cfg.Provider
	if prov == nil {
		if strings.TrimSpace(cfg.Issuer) == "" {
			return nil, errors.New("auth: bearer verifier requires provider or issuer")
		}
		var err error
		prov, err = oidc.NewProvider(ctx, cfg.Issuer)
		if err != nil {
			return nil, fmt.Errorf("auth: bearer discovery: %w", err)
		}
	}
	ttl := cfg.UserInfoTTL
	if ttl <= 0 {
		ttl = defaultUserInfoCacheTTL
	}
	verifier := prov.Verifier(&oidc.Config{ClientID: cfg.Audience})
	v := &BearerVerifier{
		verifier:    verifier,
		rbac:        rbac,
		cache:       c,
		userInfoTTL: ttl,
		log:         cfg.Log,
		fetchUserInfo: func(uCtx context.Context, rawToken string) (claims, error) {
			var cl claims
			ui, err := prov.UserInfo(uCtx, oauth2.StaticTokenSource(&oauth2.Token{AccessToken: rawToken}))
			if err != nil {
				return cl, err
			}
			if err := ui.Claims(&cl); err != nil {
				return cl, err
			}
			return cl, nil
		},
	}
	return v, nil
}

// Authenticate validates the Authorization: Bearer <jwt> header and maps the
// verified identity and group claims into a portal user.
func (b *BearerVerifier) Authenticate(r *http.Request) (*models.User, error) {
	raw := extractBearer(r.Header.Get("Authorization"))
	if raw == "" {
		return nil, ErrUnauthenticated
	}
	ctx := r.Context()
	tok, err := b.verifier.Verify(ctx, raw)
	if err != nil {
		b.logger().Warn("mcp auth failed", "reason", "invalid_token", "err", err)
		return nil, ErrUnauthenticated
	}
	var cl claims
	if err := tok.Claims(&cl); err != nil {
		b.logger().Warn("mcp auth failed", "reason", "invalid_claims", "err", err)
		return nil, ErrUnauthenticated
	}
	// Check whether the JWT actually carried a "groups" key (an empty slice can
	// mean either "no groups" or "mapper not attached to access token").
	var rawMap map[string]json.RawMessage
	_ = tok.Claims(&rawMap)
	if _, hasGroups := rawMap["groups"]; !hasGroups && b.fetchUserInfo != nil {
		if ui, uerr := b.lookupUserInfo(ctx, raw); uerr == nil {
			cl.Groups = ui.Groups
			if cl.Email == "" {
				cl.Email = ui.Email
			}
			if cl.Username == "" {
				cl.Username = ui.Username
			}
			if cl.Name == "" {
				cl.Name = ui.Name
			}
		} else {
			b.logger().Warn("mcp userinfo fallback failed", "actor", tok.Subject, "err", uerr)
		}
	}
	return b.rbac.BuildUser(tok.Subject, cl.Email, cl.Username, cl.Name, cl.Groups), nil
}

func (b *BearerVerifier) lookupUserInfo(ctx context.Context, rawToken string) (claims, error) {
	var key string
	if b.cache != nil {
		sum := sha256.Sum256([]byte(rawToken))
		key = "mcp:userinfo:" + hex.EncodeToString(sum[:])
		if data, ok, err := b.cache.Get(ctx, key); err == nil && ok {
			var cached claims
			if json.Unmarshal(data, &cached) == nil {
				return cached, nil
			}
		}
	}
	ui, err := b.fetchUserInfo(ctx, rawToken)
	if err != nil {
		return claims{}, err
	}
	if b.cache != nil && key != "" {
		if data, merr := json.Marshal(ui); merr == nil {
			_ = b.cache.Set(ctx, key, data, b.userInfoTTL)
		}
	}
	return ui, nil
}

func (b *BearerVerifier) logger() *slog.Logger {
	if b.log != nil {
		return b.log
	}
	return slog.Default()
}

func extractBearer(hdr string) string {
	scheme, token, ok := strings.Cut(strings.TrimSpace(hdr), " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") {
		return ""
	}
	return strings.TrimSpace(token)
}

// BearerMiddleware authenticates requests using a RequestAuthenticator and
// responds with a RFC 9728 WWW-Authenticate challenge on 401 Unauthorized.
func BearerMiddleware(a RequestAuthenticator, resourceMetadataURL string) func(http.Handler) http.Handler {
	challenge := "Bearer"
	if resourceMetadataURL != "" {
		challenge = fmt.Sprintf(`Bearer resource_metadata="%s"`, resourceMetadataURL)
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u, err := a.Authenticate(r)
			if err != nil || u == nil {
				w.Header().Set("WWW-Authenticate", challenge)
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
				return
			}
			next.ServeHTTP(w, r.WithContext(WithUser(r.Context(), u)))
		})
	}
}

// ProtectedResourceHandler serves RFC 9728 OAuth 2.0 Protected Resource Metadata
// so MCP clients can discover the Keycloak authorization server automatically.
func ProtectedResourceHandler(meta oauthex.ProtectedResourceMetadata) http.HandlerFunc {
	payload, _ := json.Marshal(meta)
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "public, max-age=300")
		w.WriteHeader(http.StatusOK)
		if r.Method == http.MethodGet {
			_, _ = w.Write(payload)
		}
	}
}

// OriginGuard rejects browser-originated requests whose Origin header is not in
// the allowed set. Requests without an Origin header (CLI/IDE clients) pass.
func OriginGuard(allowed []string) func(http.Handler) http.Handler {
	set := make(map[string]struct{}, len(allowed))
	for _, raw := range allowed {
		if norm := normalizeOrigin(raw); norm != "" {
			set[norm] = struct{}{}
		}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := strings.TrimSpace(r.Header.Get("Origin"))
			if origin == "" {
				next.ServeHTTP(w, r)
				return
			}
			norm := normalizeOrigin(origin)
			if _, ok := set[norm]; !ok {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden_origin"})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// NormalizeOrigin extracts canonical "scheme://host[:port]" (lowercased) from a
// URL or origin string, returning "" if invalid.
func NormalizeOrigin(raw string) string { return normalizeOrigin(raw) }

func normalizeOrigin(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return ""
	}
	return scheme + "://" + strings.ToLower(u.Host)
}
