# Runs the portal from source on :8080 for local testing, against the real
# upstreams. Ensures Keycloak is up first, then runs the portal in the
# foreground. Stop with Ctrl+C.
#
# There is no fakes mode: the portal always talks to the real Harbor, GitLab and
# Argo CD and refuses to start without their URLs and tokens. So this script
# needs the local stand up:
#   make stand-up               # KinD: Argo CD + Harbor, prints the Argo CD token
#   make up-upstreams-infra     # Postgres + Valkey + Keycloak + GitLab CE
#   make gitlab-seed            # GitOps groups + the portal's GitLab token
#
# -BindHost is the hostname the BROWSER uses to reach Keycloak/portal/SPA.
# Use "localhost" when browsing on this machine, or a LAN IP (e.g. 10.10.100.33)
# when opening the SPA via that address. The same host must be allowed in the
# realm's redirectUris/webOrigins (see deployments/keycloak/realm-internal.json).
#
# The portal restarts itself on every saved .go file when air is installed
# (go install github.com/air-verse/air@latest). -NoWatch runs it once instead.
#
# Usage:  .\deployments\scripts\run-oidc.ps1
#         .\deployments\scripts\run-oidc.ps1 -BindHost 10.10.100.33
#         .\deployments\scripts\run-oidc.ps1 -BindHost 10.10.100.33 -NoWatch
# If script execution is blocked:
#   powershell -ExecutionPolicy Bypass -File .\deployments\scripts\run-oidc.ps1 -BindHost 10.10.100.33
param([string]$BindHost = "localhost", [switch]$NoWatch)
$ErrorActionPreference = "Stop"
# Repo root = two levels up (deployments/scripts/ -> deployments/ -> repo).
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

# Make sure Keycloak is running (the portal is not a compose service - it runs
# here on the host, so there is nothing on :8080 to stop).
Push-Location (Join-Path $root "deployments")
try {
  docker compose up -d keycloak | Out-Null
} finally {
  Pop-Location
}

$env:AUTH_MODE = "oidc"
# Non-default session-encryption key: the portal refuses to start in oidc mode
# while SESSION_SECRET equals the built-in default. Fixed local-dev value (NOT a
# real secret) so sessions survive restarts on the stand.
$env:SESSION_SECRET = "dev-local-session-key-not-for-production"
# The stand is served over plain HTTP (and often a LAN IP, not localhost), where
# browsers drop Secure cookies - the oauth_state cookie would be lost and the
# callback would fail with "invalid state". COOKIE_SECURE defaults to true (prod
# is HTTPS); turn it off for this HTTP dev runner.
$env:COOKIE_SECURE = "false"
$env:OIDC_ISSUER = "http://${BindHost}:8081/realms/internal"
$env:OIDC_CLIENT_ID = "portal"
$env:OIDC_CLIENT_SECRET = "portal-secret"
# Host-dev UI lives on the Vite origin (:5173); the SPA starts login there and
# Vite proxies /api to the portal. The OIDC callback must return to the SAME
# origin or the oauth_state cookie set on :5173 is absent on :8080 -> "invalid
# state". The :5173 callback URI is registered in realm-internal.json.
$env:OIDC_REDIRECT_URL = "http://${BindHost}:5173/api/v1/auth/callback"
$env:OIDC_POST_LOGIN_REDIRECT = "http://${BindHost}:5173/"
$env:OIDC_POST_LOGOUT_REDIRECT = "http://${BindHost}:5173/"
$env:OIDC_SCOPES = "openid,profile,email"
$env:RBAC_ADMIN_GROUPS = "platform-admins"
$env:RBAC_SUPPORT_GROUPS = "support"
$env:RBAC_SECURITY_GROUPS = "security"

# Real GitLab CE + compose Postgres/Valkey (ports exposed on the host).
$env:GITLAB_URL           = "http://localhost:8929"
$env:GITLAB_TOKEN         = "glpat-localdev0123456789abcd"
$env:GITLAB_AUTO_MERGE    = "true"   # poller merges portal MRs itself (no human gate)
$env:STATUS_POLL_INTERVAL = "5s"     # snappier status progression for the demo
# The reconcile loop reports its routine decisions at Debug (why a merge is
# still waiting, which orders a sweep touched). At the default "info" the stand
# shows only outcomes, which is exactly what you need on the stand when an order
# stops moving and you want to know what the poller is seeing.
$env:LOG_LEVEL = "debug"
# Status freshness on the stand: hybrid (poll + webhooks). Default is already
# hybrid; set explicit so it is obvious. Do NOT use "webhook" here - Harbor
# webhooks cannot reach the host-run portal from a KinD pod (see kind/README.md).
$env:STATUS_UPDATE_MODE = "hybrid"
# Webhook secrets (stand-fixed, NOT real) so STATUS_UPDATE_MODE=hybrid registers
# the GitLab/Harbor webhook endpoints and the WARNs go away. NOTE: Harbor ->
# portal does NOT reach this host-run portal (KinD pod cannot connect to a native
# host port); GitLab does.
$env:GITLAB_WEBHOOK_TOKEN  = "stand-gl-webhook-secret"
$env:HARBOR_WEBHOOK_SECRET = "stand-hb-webhook-secret"
# With the URL set the portal registers that GitLab webhook itself at startup and
# on every repo it creates, so no hook has to be added by hand. GitLab connects
# from its container, where the host-run portal is host.docker.internal:8080 (NOT
# localhost - that is the GitLab container). It still needs "allow local network
# requests" enabled once: make stand-gitlab-webhooks does that.
$env:GITLAB_WEBHOOK_URL = "http://host.docker.internal:8080/api/v1/webhooks/gitlab"
# Reverse sync against Git:
#  - drift: flag orders edited directly in Git (read-only). Default true anyway;
#    set explicit so it's easy to flip off here.
#  - import: adopt application.yaml created in Git outside the portal. Off by
#    default (creates order rows); on here to exercise it on the stand.
$env:DRIFT_DETECTION_ENABLED  = "true"
$env:IMPORT_DISCOVERY_ENABLED = "true"
# Catalog autodiscovery: every chart found in the scanned Harbor projects becomes
# a draft publication waiting to be curated (category + owner). Off by default
# because it writes publication rows; on here so a freshly pushed chart shows up
# on the stand without seeding the catalog by hand.
$env:CATALOG_AUTODISCOVER = "true"
# Harbor from the KinD stand (NodePort on host port 8084, self-signed TLS). The
# host-run portal reads the catalog here via the published port (localhost, like
# GITLAB_URL/ARGOCD_URL). Only the `platform` project holds charts on the stand -
# listing the absent `managed-services` project would 401 anonymously.
$env:HARBOR_URL          = "https://localhost:8084"
$env:HARBOR_INSECURE_TLS = "true"
$env:HARBOR_PROJECTS     = "platform"
# OCI registry base baked into the committed application.yaml chart source (Argo
# pulls the chart from Harbor; values come from git). MUST stay host.docker.internal
# - that's the name Argo pods resolve inside KinD (via CoreDNS), not localhost.
$env:CHART_REGISTRY = "host.docker.internal:8084"
$env:STORE        = "postgres"
$env:DATABASE_URL = "postgres://portal:portal@localhost:5432/portal?sslmode=disable"
$env:CACHE        = "redis"
$env:REDIS_URL    = "redis://localhost:6379/0"

# Argo CD from the local KinD stand: the node publishes argocd-server on host
# port 8083. The token comes from deployments/.env (printed by `make stand-up`).
# Without it the portal will not start - there is no fake to fall back to.
if (-not $env:ARGOCD_TOKEN) {
  $envFile = Join-Path $root "deployments\.env"
  if (Test-Path $envFile) {
    $m = Select-String -Path $envFile -Pattern '^\s*ARGOCD_TOKEN\s*=\s*(.+)$' | Select-Object -First 1
    if ($m) { $env:ARGOCD_TOKEN = $m.Matches[0].Groups[1].Value.Trim() }
  }
}
if (-not $env:ARGOCD_TOKEN) {
  Write-Host "ARGOCD_TOKEN is not set and deployments\.env has none." -ForegroundColor Red
  Write-Host "Mint one with 'make stand-token' (or 'make stand-up', which prints it) and put it in deployments\.env." -ForegroundColor Red
  exit 1
}
$env:ARGOCD_URL     = "http://localhost:8083"
$env:ARGOCD_PROJECT = "portal-managed"

Write-Host "Upstreams: Harbor https://localhost:8084, GitLab http://localhost:8929, Argo CD http://localhost:8083" -ForegroundColor Yellow
Write-Host "Portal -> OIDC mode on :8080 (Keycloak http://${BindHost}:8081). Open the SPA at http://${BindHost}:5173" -ForegroundColor Green

# Stamp version/commit/date into the binary so the "About" page is populated.
# `go run` does NOT apply the toolchain's VCS stamping, so inject explicitly.
$pkg = "console/internal/buildinfo"
$version = (& git -C $root describe --tags --always --dirty 2>$null)
if (-not $version) { $version = "dev" }
$commit = (& git -C $root rev-parse --short HEAD 2>$null)
$date = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
$ldflags = "-X $pkg.Version=$version -X $pkg.Commit=$commit -X $pkg.Date=$date"

Push-Location $root
try {
  # Live reload by default: air rebuilds and restarts the portal on every saved
  # .go file, so a backend change costs a save instead of a Ctrl+C and a scroll
  # back through this script's output. -NoWatch runs it once, the way it always
  # ran; air is also skipped, with a note, when it is not installed - a missing
  # dev tool must not stop the stand from coming up.
  $air = if ($NoWatch) { $null } else { Get-Command air -ErrorAction SilentlyContinue }
  if ($air) {
    Write-Host "Live reload: air watches *.go and restarts the portal (Ctrl+C to stop)" -ForegroundColor Green
    & $air.Source
  } else {
    if (-not $NoWatch) {
      Write-Host "air is not installed, running once. Install it for live reload:" -ForegroundColor DarkYellow
      Write-Host "  go install github.com/air-verse/air@latest" -ForegroundColor DarkYellow
    }
    go run -ldflags $ldflags ./cmd/portal
  }
} finally {
  Pop-Location
}
