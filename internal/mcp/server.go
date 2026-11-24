// Package mcp exposes Console's domain capabilities over the Model Context
// Protocol (Streamable HTTP, stateless) on a dedicated listener.
package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"console/internal/api"
	"console/internal/auth"
	"console/internal/buildinfo"
	"console/internal/observability"
	"console/pkg/models"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	sdkmcp "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/modelcontextprotocol/go-sdk/oauthex"
)

const (
	// maxRequestBodyBytes caps incoming MCP JSON-RPC requests to bound memory.
	maxRequestBodyBytes = 4 << 20 // 4 MiB
	// maxTextBytes caps large text fields (README, values.yaml, changelogs)
	// returned in tool responses so a single call cannot blow up client context.
	maxTextBytes = 64 * 1024
)

// Server wires Console's domain services into a stateless MCP Streamable HTTP
// endpoint plus RFC 9728 Protected Resource Metadata.
type Server struct {
	Auth           auth.RequestAuthenticator
	API            *api.Server
	PublicURL      string
	MCPPublicURL   string
	MCPPath        string
	OIDCIssuer     string
	OIDCScopes     []string
	WriteEnabled   bool
	AllowedOrigins []string
	Log            *slog.Logger
}

// Handler builds the HTTP handler tree for the dedicated MCP listener.
func (s *Server) Handler() http.Handler {
	mcpPath := s.mcpPath()
	metaPath := "/.well-known/oauth-protected-resource"
	baseURL := strings.TrimRight(s.MCPPublicURL, "/")

	resourceURL := baseURL + mcpPath
	resourceMetadataURL := ""
	if baseURL != "" {
		resourceMetadataURL = baseURL + metaPath
	}

	meta := oauthex.ProtectedResourceMetadata{
		Resource:               resourceURL,
		ResourceName:           "Console",
		BearerMethodsSupported: []string{"header"},
		ScopesSupported:        s.OIDCScopes,
	}
	if s.OIDCIssuer != "" {
		meta.AuthorizationServers = []string{s.OIDCIssuer}
	}
	prmHandler := auth.ProtectedResourceHandler(meta)

	stdSrv := s.newMCPServer(false)
	adminSrv := s.newMCPServer(true)
	streamHandler := sdkmcp.NewStreamableHTTPHandler(func(r *http.Request) *sdkmcp.Server {
		if u := auth.UserFrom(r.Context()); u != nil && u.IsAdmin() {
			return adminSrv
		}
		return stdSrv
	}, &sdkmcp.StreamableHTTPOptions{
		Stateless:           true,
		MaxRequestBodyBytes: maxRequestBodyBytes,
		Logger:              s.logger(),
	})

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Recoverer)
	r.Use(s.requestLogger)

	// RFC 9728 Protected Resource Metadata (public, pre-auth). Serve both the
	// root well-known path and the path-scoped variant so every MCP client
	// discovery implementation finds it.
	r.Get(metaPath, prmHandler)
	r.Head(metaPath, prmHandler)
	if mcpPath != "/" {
		scopedMeta := metaPath + mcpPath
		r.Get(scopedMeta, prmHandler)
		r.Head(scopedMeta, prmHandler)
	}

	r.Group(func(r chi.Router) {
		r.Use(maxBytes(maxRequestBodyBytes))
		r.Use(auth.OriginGuard(s.effectiveAllowedOrigins()))
		r.Use(auth.BearerMiddleware(s.Auth, resourceMetadataURL))
		if s.API != nil && s.API.Activity != nil {
			r.Use(s.API.Activity.Middleware)
		}
		r.Handle(mcpPath, streamHandler)
	})

	return r
}

func (s *Server) newMCPServer(isAdmin bool) *sdkmcp.Server {
	srv := sdkmcp.NewServer(&sdkmcp.Implementation{
		Name:    "console",
		Title:   "Console Internal Developer Portal",
		Version: buildinfo.Get().Version,
	}, &sdkmcp.ServerOptions{
		Instructions: "Console Internal Developer Portal MCP server. Use tools to inspect the chart catalog, chart schemas and defaults, team orders, merge requests, drift, and publication views. Dry-run validate values before creating drafts.",
		Logger:       s.logger(),
	})

	s.registerCatalogTools(srv)
	s.registerOrderTools(srv)
	s.registerPublicationTools(srv, isAdmin)
	s.registerResources(srv)
	return srv
}

func (s *Server) mcpPath() string {
	p := strings.TrimSpace(s.MCPPath)
	if p == "" {
		return "/mcp"
	}
	if !strings.HasPrefix(p, "/") {
		return "/" + p
	}
	return p
}

func (s *Server) effectiveAllowedOrigins() []string {
	if len(s.AllowedOrigins) > 0 {
		return s.AllowedOrigins
	}
	var out []string
	if o := auth.NormalizeOrigin(s.MCPPublicURL); o != "" {
		out = append(out, o)
	}
	return out
}

func (s *Server) portalURL(path string) string {
	base := strings.TrimRight(s.PublicURL, "/")
	if base == "" {
		return ""
	}
	return base + path
}

func (s *Server) logger() *slog.Logger {
	if s.Log != nil {
		return s.Log
	}
	return slog.Default()
}

func (s *Server) requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		start := time.Now()
		next.ServeHTTP(ww, r)
		s.logger().LogAttrs(r.Context(), slog.LevelInfo, "mcp http request",
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.Int("status", ww.Status()),
			slog.Int("bytes", ww.BytesWritten()),
			slog.Int64("duration_ms", time.Since(start).Milliseconds()),
			slog.String("request_id", middleware.GetReqID(r.Context())),
		)
	})
}

func maxBytes(n int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Body != nil {
				r.Body = http.MaxBytesReader(w, r.Body, n)
			}
			next.ServeHTTP(w, r)
		})
	}
}

// runTool executes an MCP tool handler with uniform authentication check,
// maintenance gating, error mapping, structured logging, and Prometheus metrics.
func (s *Server) runTool(
	ctx context.Context,
	tool string,
	allowMaintenance bool,
	fn func(ctx context.Context, u *models.User) (any, error),
) (*sdkmcp.CallToolResult, any, error) {
	start := time.Now()
	u := auth.UserFrom(ctx)
	actor := ""
	if u != nil {
		actor = u.Subject
	}
	if u == nil {
		return s.finishTool(ctx, tool, actor, start, nil, auth.ErrUnauthenticated)
	}
	if !allowMaintenance && s.maintenanceBlocked(ctx, u) {
		observability.ObserveMaintenanceBlocked()
		return s.finishTool(ctx, tool, actor, start, nil, errMaintenance)
	}
	out, err := fn(ctx, u)
	return s.finishTool(ctx, tool, actor, start, out, err)
}

func (s *Server) finishTool(
	ctx context.Context,
	tool, actor string,
	start time.Time,
	out any,
	err error,
) (*sdkmcp.CallToolResult, any, error) {
	dur := time.Since(start)
	if err != nil {
		code, payload, level := mapError(err)
		observability.ObserveMCPTool(tool, code, dur)
		attrs := []slog.Attr{
			slog.String("tool", tool),
			slog.String("actor", actor),
			slog.String("status", code),
			slog.Int64("duration_ms", dur.Milliseconds()),
			slog.String("request_id", middleware.GetReqID(ctx)),
		}
		if level >= slog.LevelWarn {
			attrs = append(attrs, slog.String("err", err.Error()))
		}
		s.logger().LogAttrs(ctx, level, "mcp tool call", attrs...)
		return jsonToolError(payload), nil, nil
	}

	observability.ObserveMCPTool(tool, "ok", dur)
	s.logger().LogAttrs(ctx, slog.LevelInfo, "mcp tool call",
		slog.String("tool", tool),
		slog.String("actor", actor),
		slog.String("status", "ok"),
		slog.Int64("duration_ms", dur.Milliseconds()),
		slog.String("request_id", middleware.GetReqID(ctx)),
	)
	return jsonToolResult(out), nil, nil
}

func (s *Server) maintenanceBlocked(ctx context.Context, u *models.User) bool {
	if s.API == nil || s.API.Maintenance == nil {
		return false
	}
	return s.API.Maintenance.Blocks(ctx, u)
}

func jsonToolResult(v any) *sdkmcp.CallToolResult {
	b, err := json.Marshal(v)
	if err != nil {
		return jsonToolError(toolErrorPayload{Error: "internal", Message: "failed to encode response"})
	}
	return &sdkmcp.CallToolResult{
		Content: []sdkmcp.Content{
			&sdkmcp.TextContent{Text: string(b)},
		},
	}
}

func jsonToolError(payload toolErrorPayload) *sdkmcp.CallToolResult {
	b, _ := json.Marshal(payload)
	return &sdkmcp.CallToolResult{
		IsError: true,
		Content: []sdkmcp.Content{
			&sdkmcp.TextContent{Text: string(b)},
		},
	}
}

func boolPtr(v bool) *bool { return &v }

func readOnlyAnnotations(title string) *sdkmcp.ToolAnnotations {
	return &sdkmcp.ToolAnnotations{
		Title:           title,
		ReadOnlyHint:    true,
		DestructiveHint: boolPtr(false),
		IdempotentHint:  true,
		OpenWorldHint:   boolPtr(false),
	}
}

func truncateText(s string, max int) (string, bool) {
	if max <= 0 || len(s) <= max {
		return s, false
	}
	return s[:max], true
}

func parseChartPath(raw string) (string, string, error) {
	trimmed := strings.Trim(strings.TrimSpace(raw), "/")
	project, name, ok := strings.Cut(trimmed, "/")
	if !ok || project == "" || name == "" || strings.Contains(name, "/") {
		return "", "", &badInputError{msg: `chart must have the form "project/name"`}
	}
	return project, name, nil
}

func clampLimit(limit, def, maxVal int) int {
	if limit <= 0 {
		return def
	}
	if limit > maxVal {
		return maxVal
	}
	return limit
}

// isExpectedResourceErr checks whether a resource error maps to a standard MCP
// resource-not-found error rather than an unexpected internal failure.
func isNotFoundErr(err error) bool {
	return errors.Is(err, models.ErrNotFound)
}
