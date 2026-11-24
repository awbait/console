package mcp_test

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"console/internal/api"
	"console/internal/argocd"
	"console/internal/auth"
	"console/internal/cache"
	"console/internal/catalog"
	"console/internal/config"
	"console/internal/events"
	"console/internal/gitlab"
	"console/internal/harbor"
	"console/internal/maintenance"
	"console/internal/mcp"
	"console/internal/provisioning"
	"console/internal/publications"
	"console/internal/store"
	"console/pkg/models"
	sdkmcp "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/modelcontextprotocol/go-sdk/oauthex"
)

type tokenAuth map[string]*models.User

func (a tokenAuth) Authenticate(r *http.Request) (*models.User, error) {
	hdr := r.Header.Get("Authorization")
	tok, ok := strings.CutPrefix(hdr, "Bearer ")
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	u := a[tok]
	if u == nil {
		return nil, auth.ErrUnauthenticated
	}
	return u, nil
}

type bearerRoundTripper struct {
	base  http.RoundTripper
	token string
}

func (b *bearerRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) {
	cp := r.Clone(r.Context())
	if b.token != "" {
		cp.Header.Set("Authorization", "Bearer "+b.token)
	}
	return b.base.RoundTrip(cp)
}

// testHarbor wraps harbor.Fake to add a team-restricted chart and optional
// upstream error injection without touching production fakes.
type testHarbor struct {
	*harbor.Fake
	mu      sync.Mutex
	failErr error
}

func (h *testHarbor) SetError(err error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.failErr = err
}

func (h *testHarbor) err() error {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.failErr
}

func (h *testHarbor) ListCharts(ctx context.Context) ([]models.Chart, error) {
	if err := h.err(); err != nil {
		return nil, err
	}
	charts, err := h.Fake.ListCharts(ctx)
	if err != nil {
		return nil, err
	}
	charts = append(charts, models.Chart{
		Project:       "platform",
		Name:          "secret-svc",
		Description:   "Restricted internal service",
		LatestVersion: "1.0.0",
		Versions:      []string{"1.0.0"},
		AllowedTeams:  []string{"payments"},
	})
	return charts, nil
}

func (h *testHarbor) GetChart(ctx context.Context, project, name string) (*models.Chart, error) {
	if err := h.err(); err != nil {
		return nil, err
	}
	if project == "platform" && name == "secret-svc" {
		return &models.Chart{
			Project:       "platform",
			Name:          "secret-svc",
			Description:   "Restricted internal service",
			LatestVersion: "1.0.0",
			Versions:      []string{"1.0.0"},
			AllowedTeams:  []string{"payments"},
		}, nil
	}
	return h.Fake.GetChart(ctx, project, name)
}

func (h *testHarbor) GetVersion(ctx context.Context, project, name, version string) (*models.ChartVersion, error) {
	if project == "platform" && name == "secret-svc" && version == "1.0.0" {
		return &models.ChartVersion{Version: "1.0.0", AppVersion: "1.0.0", Digest: "sha256:secret"}, nil
	}
	return h.Fake.GetVersion(ctx, project, name, version)
}

func (h *testHarbor) GetReadme(ctx context.Context, project, name, version string) ([]byte, error) {
	if project == "platform" && name == "secret-svc" && version == "1.0.0" {
		return []byte("# Secret Service"), nil
	}
	return h.Fake.GetReadme(ctx, project, name, version)
}

func (h *testHarbor) GetValues(ctx context.Context, project, name, version string) ([]byte, error) {
	if project == "platform" && name == "secret-svc" && version == "1.0.0" {
		return []byte("enabled: true\n"), nil
	}
	return h.Fake.GetValues(ctx, project, name, version)
}

func (h *testHarbor) GetSchema(ctx context.Context, project, name, version string) ([]byte, error) {
	if project == "platform" && name == "secret-svc" && version == "1.0.0" {
		return []byte(`{"type":"object"}`), nil
	}
	return h.Fake.GetSchema(ctx, project, name, version)
}

func (h *testHarbor) GetDependencies(ctx context.Context, project, name, version string) ([]models.ChartDependency, error) {
	if project == "platform" && name == "secret-svc" && version == "1.0.0" {
		return nil, nil
	}
	return h.Fake.GetDependencies(ctx, project, name, version)
}

type testEnv struct {
	st    store.Store
	hb    *testHarbor
	gl    *gitlab.Fake
	argo  *argocd.Fake
	maint *maintenance.Service
	pubs  *publications.Service
	prov  *provisioning.Service
	api   *api.Server
	http  *httptest.Server
	pubID string
}

func newTestEnv(t *testing.T, writeEnabled bool) *testEnv {
	t.Helper()
	ctx := context.Background()
	st := store.NewMemory()
	_ = store.SeedCategories(ctx, st)
	_, _ = store.SeedDefaultStand(ctx, st, "in-cluster", "managed-services")

	c := cache.NewMemory()
	bus := events.New()

	hb := &testHarbor{Fake: harbor.NewFake()}
	gl := gitlab.NewFake("managed-services", []string{"team-core", "team-payments"}, false)
	argo := argocd.NewFake(gl)
	gitops, err := provisioning.NewGitOps("managed-services", "team-{{.Team}}", "{{.Team}}-{{.Chart}}-{{.Namespace}}-{{.ServiceName}}", "portal-managed", "main")
	if err != nil {
		t.Fatalf("gitops: %v", err)
	}
	catSvc := catalog.New(hb, c)
	provSvc := provisioning.New(st, gl, argo, catSvc, gitops, bus, "in-cluster", "main", false)
	pubsSvc := publications.New(st, catSvc)
	pubsSvc.SetLeases(c)
	maint := maintenance.New(st, nil, nil, false, slog.New(slog.DiscardHandler))

	adminUser := &models.User{Subject: "admin-1", Name: "Admin", Role: models.RoleAdmin, Teams: []string{"core"}}
	_ = pubsSvc.CreateCategory(ctx, adminUser, &models.Category{ID: "databases", Label: "Databases", Sort: 1})
	pub, err := pubsSvc.Create(ctx, adminUser, publications.CreateInput{
		ChartProject: "platform", ChartName: "postgres",
		CategoryID: "databases", OwnerTeam: "core",
	})
	if err != nil {
		t.Fatalf("create publication: %v", err)
	}
	viewDoc := []byte(`{"views":{"order":{"identity":"/auth/database"}}}`)
	if _, err := pubsSvc.SaveVersionView(ctx, adminUser, pub.ID, "15.4.2", viewDoc); err != nil {
		t.Fatalf("save view: %v", err)
	}
	if _, err := pubsSvc.SubmitVersion(ctx, adminUser, pub.ID, "15.4.2"); err != nil {
		t.Fatalf("submit view: %v", err)
	}
	if _, err := pubsSvc.ApproveVersion(ctx, adminUser, pub.ID, "15.4.2"); err != nil {
		t.Fatalf("approve view: %v", err)
	}
	if _, err := pubsSvc.SetVersionOrderable(ctx, adminUser, pub.ID, "15.4.2", true); err != nil {
		t.Fatalf("orderable: %v", err)
	}

	apiSrv := &api.Server{
		Catalog:     catSvc,
		Prov:        provSvc,
		Pubs:        pubsSvc,
		Store:       st,
		Cache:       c,
		Bus:         bus,
		Harbor:      hb,
		GitLab:      gl,
		ArgoCD:      argo,
		Maintenance: maint,
		ArgoCDURL:   "https://argocd.local",
		Config: &config.Config{
			HTTPPort:      "8080",
			MCPPort:       "8090",
			MCPEnabled:    true,
			SessionSecret: "super-secret-value-never-leaked",
			GitLabToken:   "glpat-super-secret",
		},
		Log: slog.New(slog.DiscardHandler),
	}

	users := tokenAuth{
		"member-core": {Subject: "u-core", Name: "Alice Core", Email: "alice@example.com", Username: "alice", Role: models.RoleMember, Teams: []string{"core"}},
		"member-pay":  {Subject: "u-pay", Name: "Bob Pay", Email: "bob@example.com", Username: "bob", Role: models.RoleMember, Teams: []string{"payments"}},
		"admin":       adminUser,
		"auditor":     {Subject: "u-aud", Name: "Nora Audit", Role: models.RoleAuditor, Teams: []string{}},
	}

	mcpSrv := &mcp.Server{
		Auth:         users,
		API:          apiSrv,
		PublicURL:    "https://console.local",
		MCPPublicURL: "https://mcp.console.local",
		MCPPath:      "/mcp",
		OIDCIssuer:   "https://kc.local/realms/internal",
		OIDCScopes:   []string{"openid", "profile", "email", "groups"},
		WriteEnabled: writeEnabled,
		Log:          slog.New(slog.DiscardHandler),
	}

	ts := httptest.NewServer(mcpSrv.Handler())
	t.Cleanup(ts.Close)

	return &testEnv{
		st: st, hb: hb, gl: gl, argo: argo, maint: maint,
		pubs: pubsSvc, prov: provSvc, api: apiSrv, http: ts, pubID: pub.ID,
	}
}

func (e *testEnv) connect(t *testing.T, token string) *sdkmcp.ClientSession {
	t.Helper()
	cli := sdkmcp.NewClient(&sdkmcp.Implementation{Name: "test-client", Version: "1.0.0"}, nil)
	httpCli := &http.Client{
		Transport: &bearerRoundTripper{base: e.http.Client().Transport, token: token},
	}
	sess, err := cli.Connect(context.Background(), &sdkmcp.StreamableClientTransport{
		Endpoint:             e.http.URL + "/mcp",
		HTTPClient:           httpCli,
		DisableStandaloneSSE: true,
	}, nil)
	if err != nil {
		t.Fatalf("connect mcp (%s): %v", token, err)
	}
	t.Cleanup(func() { _ = sess.Close() })
	return sess
}

func callJSON(t *testing.T, sess *sdkmcp.ClientSession, name string, args map[string]any) (map[string]any, bool) {
	t.Helper()
	res, err := sess.CallTool(context.Background(), &sdkmcp.CallToolParams{
		Name:      name,
		Arguments: args,
	})
	if err != nil {
		t.Fatalf("CallTool(%s) protocol error: %v", name, err)
	}
	if len(res.Content) == 0 {
		t.Fatalf("CallTool(%s): empty content", name)
	}
	tc, ok := res.Content[0].(*sdkmcp.TextContent)
	if !ok {
		t.Fatalf("CallTool(%s): want TextContent, got %T", name, res.Content[0])
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(tc.Text), &out); err != nil {
		t.Fatalf("CallTool(%s): invalid JSON %q: %v", name, tc.Text, err)
	}
	return out, res.IsError
}

func TestProtectedResourceMetadataAndAuthChallenge(t *testing.T) {
	env := newTestEnv(t, false)

	// RFC 9728 metadata is public and points to Keycloak.
	resp, err := env.http.Client().Get(env.http.URL + "/.well-known/oauth-protected-resource")
	if err != nil {
		t.Fatalf("get metadata: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("metadata status = %d, want 200", resp.StatusCode)
	}
	var meta oauthex.ProtectedResourceMetadata
	if err := json.NewDecoder(resp.Body).Decode(&meta); err != nil {
		t.Fatalf("decode metadata: %v", err)
	}
	if meta.Resource != "https://mcp.console.local/mcp" {
		t.Fatalf("resource = %q", meta.Resource)
	}
	if len(meta.AuthorizationServers) != 1 || meta.AuthorizationServers[0] != "https://kc.local/realms/internal" {
		t.Fatalf("authorization_servers = %v", meta.AuthorizationServers)
	}

	// Unauthenticated POST to /mcp returns 401 with resource_metadata challenge.
	req, _ := http.NewRequest(http.MethodPost, env.http.URL+"/mcp", strings.NewReader(`{}`))
	unauthResp, err := env.http.Client().Do(req)
	if err != nil {
		t.Fatalf("post /mcp: %v", err)
	}
	defer unauthResp.Body.Close()
	if unauthResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauth status = %d, want 401", unauthResp.StatusCode)
	}
	if got := unauthResp.Header.Get("WWW-Authenticate"); !strings.Contains(got, "https://mcp.console.local/.well-known/oauth-protected-resource") {
		t.Fatalf("WWW-Authenticate = %q", got)
	}

	// Foreign Origin is rejected with 403 before auth.
	originReq, _ := http.NewRequest(http.MethodPost, env.http.URL+"/mcp", strings.NewReader(`{}`))
	originReq.Header.Set("Origin", "https://evil.example")
	originReq.Header.Set("Authorization", "Bearer member-core")
	originResp, err := env.http.Client().Do(originReq)
	if err != nil {
		t.Fatalf("origin post: %v", err)
	}
	defer originResp.Body.Close()
	if originResp.StatusCode != http.StatusForbidden {
		t.Fatalf("foreign origin status = %d, want 403", originResp.StatusCode)
	}
}

func TestToolVisibilityAndRBAC(t *testing.T) {
	env := newTestEnv(t, false)
	memberSess := env.connect(t, "member-core")
	adminSess := env.connect(t, "admin")

	// Member should not see admin tools or create_draft_order when write is off.
	mTools, err := memberSess.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatalf("member ListTools: %v", err)
	}
	mNames := map[string]bool{}
	for _, tl := range mTools.Tools {
		mNames[tl.Name] = true
	}
	for _, forbidden := range []string{"get_admin_board", "get_platform_status", "get_platform_config", "create_draft_order"} {
		if mNames[forbidden] {
			t.Errorf("member should not list tool %q", forbidden)
		}
	}
	for _, expected := range []string{"whoami", "list_catalog", "get_chart_version", "list_orders", "validate_new_order"} {
		if !mNames[expected] {
			t.Errorf("member missing expected tool %q", expected)
		}
	}

	// Admin sees admin tools.
	aTools, err := adminSess.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatalf("admin ListTools: %v", err)
	}
	aNames := map[string]bool{}
	for _, tl := range aTools.Tools {
		aNames[tl.Name] = true
	}
	for _, expected := range []string{"get_admin_board", "get_platform_status", "get_platform_config"} {
		if !aNames[expected] {
			t.Errorf("admin missing expected tool %q", expected)
		}
	}

	// AllowedTeams: member-core does NOT see secret-svc in list_catalog or get_chart_version.
	catOut, isErr := callJSON(t, memberSess, "list_catalog", map[string]any{})
	if isErr {
		t.Fatalf("list_catalog error: %v", catOut)
	}
	rawCharts, _ := json.Marshal(catOut["charts"])
	if strings.Contains(string(rawCharts), "secret-svc") {
		t.Fatalf("core member should not see restricted secret-svc: %s", rawCharts)
	}
	if !strings.Contains(string(rawCharts), "platform/postgres") {
		t.Fatalf("core member should see platform/postgres: %s", rawCharts)
	}

	hiddenOut, isErr := callJSON(t, memberSess, "get_chart_version", map[string]any{
		"chart":   "platform/secret-svc",
		"version": "1.0.0",
	})
	if !isErr || hiddenOut["error"] != "not_found" {
		t.Fatalf("hidden chart should return not_found (404 semantics), got isErr=%v body=%v", isErr, hiddenOut)
	}

	// payments member CAN see secret-svc.
	paySess := env.connect(t, "member-pay")
	visOut, isErr := callJSON(t, paySess, "get_chart_version", map[string]any{
		"chart":   "platform/secret-svc",
		"version": "1.0.0",
	})
	if isErr || visOut["chart"] != "platform/secret-svc" {
		t.Fatalf("payments member should read secret-svc, got isErr=%v body=%v", isErr, visOut)
	}

	// Admin config never leaks secrets.
	cfgOut, isErr := callJSON(t, adminSess, "get_platform_config", map[string]any{})
	if isErr {
		t.Fatalf("get_platform_config error: %v", cfgOut)
	}
	cfgJSON, _ := json.Marshal(cfgOut)
	if strings.Contains(string(cfgJSON), "super-secret") {
		t.Fatalf("get_platform_config leaked a secret: %s", cfgJSON)
	}
}

func TestValidateAndCreateDraftOrder(t *testing.T) {
	env := newTestEnv(t, true)
	sess := env.connect(t, "member-core")

	// Dry-run validation catches schema violations.
	badOut, isErr := callJSON(t, sess, "validate_new_order", map[string]any{
		"chart":        "platform/postgres",
		"version":      "15.4.2",
		"team":         "core",
		"service_name": "pg-mcp",
		"values": map[string]any{
			"auth":    map[string]any{"database": "app"},
			"primary": map[string]any{"replicas": "not-an-int"},
		},
	})
	if !isErr || badOut["error"] != "validation_failed" {
		t.Fatalf("want validation_failed, got isErr=%v body=%v", isErr, badOut)
	}

	// Valid draft creation succeeds with strict validation, returns portal URL, and touches no GitLab MRs.
	draftOut, isErr := callJSON(t, sess, "create_draft_order", map[string]any{
		"chart":        "platform/postgres",
		"version":      "15.4.2",
		"team":         "core",
		"service_name": "pg-mcp",
		"values": map[string]any{
			"auth":    map[string]any{"database": "app"},
			"primary": map[string]any{"replicas": 2},
		},
	})
	if isErr {
		t.Fatalf("create_draft_order failed: %v", draftOut)
	}
	if draftOut["status"] != string(models.StatusDraft) {
		t.Fatalf("status = %v, want DRAFT", draftOut["status"])
	}
	id, _ := draftOut["id"].(string)
	wantURL := "https://console.local/requests/" + id
	if draftOut["portal_url"] != wantURL {
		t.Fatalf("portal_url = %v, want %q", draftOut["portal_url"], wantURL)
	}

	// get_order returns the draft and zero merge requests (GitLab untouched).
	orderOut, isErr := callJSON(t, sess, "get_order", map[string]any{"id": id})
	if isErr {
		t.Fatalf("get_order failed: %v", orderOut)
	}
	if mrs, _ := orderOut["merge_requests"].([]any); len(mrs) != 0 {
		t.Fatalf("draft should not open GitLab MRs, got %v", mrs)
	}

	// Another team cannot read core's order.
	paySess := env.connect(t, "member-pay")
	forbOut, isErr := callJSON(t, paySess, "get_order", map[string]any{"id": id})
	if !isErr || forbOut["error"] != "forbidden" {
		t.Fatalf("cross-team get_order: want forbidden, got isErr=%v body=%v", isErr, forbOut)
	}

	// Order resource readable by owner.
	res, err := sess.ReadResource(context.Background(), &sdkmcp.ReadResourceParams{
		URI: "console://orders/" + id,
	})
	if err != nil || len(res.Contents) == 0 || !strings.Contains(res.Contents[0].Text, "pg-mcp") {
		t.Fatalf("ReadResource(order): err=%v res=%+v", err, res)
	}
}

func TestMaintenanceGateAndResources(t *testing.T) {
	env := newTestEnv(t, false)
	ctx := context.Background()
	adminUser := &models.User{Subject: "admin-1", Name: "Admin", Role: models.RoleAdmin}

	memberSess := env.connect(t, "member-core")
	adminSess := env.connect(t, "admin")

	// Resources work before maintenance.
	vs, err := memberSess.ReadResource(ctx, &sdkmcp.ReadResourceParams{URI: "console://view-schema"})
	if err != nil || len(vs.Contents) == 0 || !strings.Contains(vs.Contents[0].Text, "$schema") {
		t.Fatalf("ReadResource(view-schema): err=%v res=%+v", err, vs)
	}
	readme, err := memberSess.ReadResource(ctx, &sdkmcp.ReadResourceParams{URI: "console://charts/platform/postgres/15.4.2/readme"})
	if err != nil || len(readme.Contents) == 0 || !strings.Contains(readme.Contents[0].Text, "PostgreSQL") {
		t.Fatalf("ReadResource(readme): err=%v res=%+v", err, readme)
	}
	// Hidden chart resource returns not found.
	if _, err := memberSess.ReadResource(ctx, &sdkmcp.ReadResourceParams{URI: "console://charts/platform/secret-svc/1.0.0/readme"}); err == nil {
		t.Fatal("expected error reading hidden chart resource")
	}

	// Enable maintenance window (active immediately: nil StartsAt, EndsAt in future).
	end := time.Now().Add(time.Hour).UTC()
	if _, err := env.maint.Set(ctx, adminUser, maintenance.Input{
		EndsAt:  &end,
		Message: "Planned upgrade",
	}); err != nil {
		t.Fatalf("enable maintenance: %v", err)
	}

	// Non-admin whoami still works and reports maintenance.
	who, isErr := callJSON(t, memberSess, "whoami", map[string]any{})
	if isErr {
		t.Fatalf("whoami should stay open during maintenance, got %v", who)
	}
	// Non-admin catalog tool is blocked by maintenance.
	blocked, isErr := callJSON(t, memberSess, "list_catalog", map[string]any{})
	if !isErr || blocked["error"] != "maintenance" {
		t.Fatalf("list_catalog during maintenance: want maintenance error, got isErr=%v body=%v", isErr, blocked)
	}
	// Admin passes maintenance gate.
	board, isErr := callJSON(t, adminSess, "get_admin_board", map[string]any{})
	if isErr || board["generated_at"] == nil {
		t.Fatalf("admin should pass maintenance gate, got isErr=%v body=%v", isErr, board)
	}
}

func TestUpstreamErrorNotLeaked(t *testing.T) {
	env := newTestEnv(t, false)
	env.hb.SetError(errors.New("dial tcp 10.42.0.9:8084: connection refused"))

	sess := env.connect(t, "member-core")
	out, isErr := callJSON(t, sess, "list_catalog", map[string]any{})
	if !isErr {
		t.Fatalf("expected error on upstream failure, got %v", out)
	}
	raw, _ := json.Marshal(out)
	if strings.Contains(string(raw), "10.42.0.9") {
		t.Fatalf("upstream host leaked in MCP error response: %s", raw)
	}
}

func TestPublicationAndViewAuthoringTools(t *testing.T) {
	env := newTestEnv(t, false)
	sess := env.connect(t, "member-core")

	ctxOut, isErr := callJSON(t, sess, "get_view_authoring_context", map[string]any{})
	if isErr || ctxOut["view_schema"] == nil || ctxOut["template_refs"] == nil {
		t.Fatalf("get_view_authoring_context failed: isErr=%v body=%v", isErr, ctxOut)
	}

	pubsOut, isErr := callJSON(t, sess, "list_publications", map[string]any{})
	if isErr {
		t.Fatalf("list_publications failed: %v", pubsOut)
	}
	versOut, isErr := callJSON(t, sess, "get_publication_versions", map[string]any{"publication_id": env.pubID})
	if isErr || versOut["publication"] == nil {
		t.Fatalf("get_publication_versions failed: isErr=%v body=%v", isErr, versOut)
	}

	valOut, isErr := callJSON(t, sess, "validate_publication_version", map[string]any{
		"publication_id": env.pubID,
		"version":        "15.4.2",
		"view":           map[string]any{"views": map[string]any{"order": map[string]any{"identity": "/auth/database"}}},
	})
	if isErr || valOut["valid"] != true {
		t.Fatalf("validate_publication_version failed: isErr=%v body=%v", isErr, valOut)
	}
}
