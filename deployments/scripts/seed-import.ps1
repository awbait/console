# Seed a service directly into Git (bypassing the portal) to test import/discovery.
#
# Commits application.yaml + values.yaml for an ingress-gateway instance under
# managed-services/team-<Team>/ingress-gateway/<Cluster>/<Service>/, exactly where
# the portal's GitOps convention expects them — but WITHOUT going through the
# portal. With IMPORT_DISCOVERY_ENABLED=true the import reconciler then adopts it
# as an IMPORTED order (and the app-of-apps ApplicationSet will also deploy it).
#
# Prereqs: real GitLab up (`make up-upstreams` + `make gitlab-seed`) so the
# managed-services group + team-<Team> subgroup exist.
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts/seed-import.ps1
#         ... -Team dbaas -Service my-gw -Version 3.1.0
param(
    [string]$GitlabApi   = "http://localhost:8929",                 # API reachable from the host
    [string]$GitlabToken = "glpat-localdev0123456789abcd",
    [string]$Team        = "core",
    [string]$Chart       = "ingress-gateway",
    [string]$Service     = "impgw",   # = Gateway name, must be a 2..6 char shortToken (schema)
    [string]$Version     = "3.1.0",
    [string]$Cluster     = "in-cluster",
    [string]$Namespace   = "",
    [string]$ChartRegistry = "host.docker.internal:8084/platform",  # Harbor OCI base (chart source)
    [string]$GitHost     = "host.docker.internal:8929"              # host Argo pods resolve (values source)
)
$ErrorActionPreference = "Stop"
if (-not $Namespace) { $Namespace = $Service }

$hdr  = @{ "PRIVATE-TOKEN" = $GitlabToken }
$B    = "$GitlabApi/api/v4"
$subgroupPath = "managed-services/team-$Team"
$repoPath     = "$subgroupPath/$Chart"

function UrlEnc([string]$s) { return [uri]::EscapeDataString($s) }

# 1. Resolve the team subgroup (must already be seeded).
try {
    $sg = Invoke-RestMethod -Headers $hdr -Uri "$B/groups/$(UrlEnc $subgroupPath)"
} catch {
    throw "subgroup '$subgroupPath' not found - run 'make gitlab-seed' first (or pick an existing -Team)"
}

# 2. Ensure the chart repo exists under the subgroup.
try {
    $proj = Invoke-RestMethod -Headers $hdr -Uri "$B/projects/$(UrlEnc $repoPath)"
    Write-Host "[seed-import] repo '$repoPath' exists (id=$($proj.id))"
} catch {
    $proj = Invoke-RestMethod -Headers $hdr -Method Post -Uri "$B/projects" `
        -Body (@{ name = $Chart; path = $Chart; namespace_id = $sg.id } | ConvertTo-Json) `
        -ContentType "application/json"
    Write-Host "[seed-import] created repo '$repoPath' (id=$($proj.id))"
}
$projId = $proj.id
$branch = if ($proj.default_branch) { $proj.default_branch } else { "main" }

# 3. Build the manifests (mirrors internal/provisioning/gitops.go RenderApplication).
$appName     = "$Team-$Service"
$instanceDir = "$Cluster/$Service"
$gitRepo     = "http://$GitHost/$repoPath.git"

# NOTE: this MUST stay byte-identical (semantically) to what the portal renders
# (internal/provisioning/gitops.go RenderApplication) — import only adopts
# manifests that re-render to exactly this. `$values` is ArgoCD's literal ref
# token, escaped so PowerShell does not interpolate it; $Team/$Chart/$Service/etc
# ARE interpolated on purpose.
$appYaml = @"
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: $appName
  namespace: argocd
  labels:
    managed-by: portal
    idp.team: $Team
    idp.chart: $Chart
    idp.service: $Service
spec:
  project: portal-managed
  destination:
    name: $Cluster
    namespace: $Namespace
  sources:
    - repoURL: $ChartRegistry
      chart: $Chart
      targetRevision: $Version
      helm:
        valueFiles:
          - `$values/$instanceDir/values.yaml
    - repoURL: $gitRepo
      targetRevision: $branch
      ref: values
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
"@

$valuesYaml = @"
# Seeded directly in Git (bypassing the portal) to test import/discovery.
# A schema-valid minimal instance: naming tags + one Gateway with one HTTP
# listener (gateway.required = [name, listeners]).
naming:
  instanceTag: ru1
  clusterTag: k8s1
  projectTag: nbox

gateways:
  - name: $Service
    enabled: true
    listeners:
      - name: http
        port: 80
        protocol: HTTP
        hostname: $Service.example.test
"@

# 4. Commit both files (create or update, so re-runs are idempotent).
function FileExists([int]$id, [string]$path, [string]$ref) {
    try {
        Invoke-RestMethod -Headers $hdr -Uri "$B/projects/$id/repository/files/$(UrlEnc $path)?ref=$(UrlEnc $ref)" | Out-Null
        return $true
    } catch { return $false }
}

$appPath = "$instanceDir/application.yaml"
$valPath = "$instanceDir/values.yaml"
$appAction = if (FileExists $projId $appPath $branch) { "update" } else { "create" }
$valAction = if (FileExists $projId $valPath $branch) { "update" } else { "create" }

$body = @{
    branch         = $branch
    commit_message = "seed $Service (import test, not via portal)"
    actions        = @(
        @{ action = $appAction; file_path = $appPath; content = $appYaml },
        @{ action = $valAction; file_path = $valPath; content = $valuesYaml }
    )
} | ConvertTo-Json -Depth 6

Invoke-RestMethod -Headers $hdr -Method Post -Uri "$B/projects/$projId/repository/commits" `
    -Body $body -ContentType "application/json" | Out-Null

Write-Host "[seed-import] committed $appPath + $valPath on '$branch'" -ForegroundColor Green
Write-Host "[seed-import] app=$appName chart=${Chart}:$Version team=$Team ns=$Namespace"
Write-Host ""
Write-Host "Next: ensure IMPORT_DISCOVERY_ENABLED=true and (re)start the portal." -ForegroundColor Yellow
Write-Host "The import reconciler adopts it as an IMPORTED order within one poll tick (~5s on the demo)."
