# Registers the GitLab -> portal merge-request webhook, so STATUS_UPDATE_MODE=
# hybrid/webhook reacts to a merge at once instead of on the next poll tick.
#
# The portal does this itself when GITLAB_WEBHOOK_URL is set (same cascade, see
# internal/gitlab/hooks.go). What it cannot do is flip the instance-wide network
# setting below, which is why this script still exists: run it once against a
# fresh GitLab, and whenever you want to register the hook without the portal.
#
# Three scopes, tried best-first (-Scope auto). Each one registers the SAME hook
# URL and secret; only the coverage differs:
#
#   group   POST /groups/:id/hooks   one hook for the whole GitOps group,
#                                    Premium+ only. Covers repos the portal
#                                    creates later - no rerun needed.
#   system  POST /hooks              one hook for the WHOLE instance, Free tier
#                                    but admin token only. Also covers future
#                                    repos; wider scope than the group, which is
#                                    harmless on a stand hosting one group.
#   project POST /projects/:id/hooks a hook per repo, works with any tier and a
#                                    plain maintainer token. A repo created
#                                    afterwards has NO hook until the next run,
#                                    whoever created it - in hybrid mode the
#                                    poller still catches its merges, in
#                                    webhook-only mode they are lost.
#
# Force one scope with -Scope group|system|project (useful to reproduce the CE
# fallback on a licensed instance, or the prod path locally).
#
# GitLab also blocks webhooks to private addresses by default; this enables
# "allow requests to the local network from webhooks" (admin) so
# host.docker.internal is reachable.
#
# Usage:  .\deployments\scripts\gitlab-webhooks.ps1
#         .\deployments\scripts\gitlab-webhooks.ps1 -Scope project
#         .\deployments\scripts\gitlab-webhooks.ps1 -Secret my-secret -PortalUrl http://host.docker.internal:8080
# Run from the repo root. Stand defaults match deployments/scripts/run-oidc.ps1.
param(
  [string]$GitLabApi = "http://localhost:8929/api/v4",
  [string]$Token     = "glpat-localdev0123456789abcd",
  [string]$Group     = "managed-services",
  [string]$Secret    = "stand-gl-webhook-secret",
  # The URL GitLab POSTs to. GitLab connects from its container, where the portal
  # is reachable as host.docker.internal:8080 (NOT localhost - that is the GitLab
  # container itself).
  [string]$PortalUrl = "http://host.docker.internal:8080",
  [ValidateSet("auto", "group", "system", "project")]
  [string]$Scope     = "auto"
)
$ErrorActionPreference = "Stop"
$H = @{ "PRIVATE-TOKEN" = $Token }
$hookUrl = "$PortalUrl/api/v1/webhooks/gitlab"
$hookBody = @{
  url = $hookUrl; token = $Secret
  merge_requests_events = $true; push_events = $false
  enable_ssl_verification = $false   # portal is plain HTTP on the stand
} | ConvertTo-Json

# Invoke-Api never throws on an HTTP error: the cascade has to tell "this tier
# cannot do it" (403/404) from a real outage, so callers branch on .Status.
function Invoke-Api {
  param([string]$Method, [string]$Uri, [string]$Body)
  try {
    $req = @{ Method = $Method; Uri = $Uri; Headers = $H; TimeoutSec = 30 }
    if ($Body) { $req.Body = $Body; $req.ContentType = "application/json" }
    return @{ Ok = $true; Status = 200; Data = (Invoke-RestMethod @req) }
  } catch {
    $code = 0
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    return @{ Ok = $false; Status = $code; Err = $_.Exception.Message }
  }
}

# Register-Hook creates or updates the hook under a collection URI. All three
# scopes share the shape: GET <base> lists, POST <base> creates, PUT <base>/<id>
# updates - so one function covers group, system and project hooks.
function Register-Hook {
  param([string]$Base, [string]$Label)
  $list = Invoke-Api -Method Get -Uri $Base
  if (-not $list.Ok) { throw "${Label}: list hooks failed ($($list.Status)) $($list.Err)" }
  $match = $list.Data | Where-Object { $_.url -eq $hookUrl } | Select-Object -First 1
  if ($match) {
    $r = Invoke-Api -Method Put -Uri "$Base/$($match.id)" -Body $hookBody
    if (-not $r.Ok) { throw "${Label}: update hook $($match.id) failed ($($r.Status)) $($r.Err)" }
    Write-Host "updated $Label (hook $($match.id))" -ForegroundColor DarkGray
  } else {
    $r = Invoke-Api -Method Post -Uri $Base -Body $hookBody
    if (-not $r.Ok) { throw "${Label}: create hook failed ($($r.Status)) $($r.Err)" }
    Write-Host "created $Label (hook $($r.Data.id)) -> $hookUrl" -ForegroundColor Green
  }
}

# 1) Allow webhooks to the local network (else host.docker.internal is blocked).
# Admin-only, and a non-admin token is exactly the case the project fallback
# exists for - so warn and carry on instead of failing the whole run.
$net = Invoke-Api -Method Put -Uri "$GitLabApi/application/settings?allow_local_requests_from_web_hooks_and_services=true"
if ($net.Ok) {
  Write-Host "allow_local_requests_from_web_hooks = $($net.Data.allow_local_requests_from_web_hooks_and_services)" -ForegroundColor Green
} else {
  Write-Host "could not set allow_local_requests_from_web_hooks ($($net.Status)) - needs an admin token." -ForegroundColor Yellow
  Write-Host "  Enable it by hand (Admin -> Settings -> Network -> Outbound requests) or deliveries to host.docker.internal are blocked." -ForegroundColor Yellow
}

# 2) Resolve the group. Needed by the group scope (hook target) and the project
# scope (repo list); a typo here must fail loudly, not fall through the cascade.
$gr = Invoke-Api -Method Get -Uri "$GitLabApi/groups/$([uri]::EscapeDataString($Group))"
if (-not $gr.Ok) { throw "group '$Group' not found ($($gr.Status)) $($gr.Err)" }
$g = $gr.Data

# 3) Scope handlers. Each returns $true when it registered the hook, $false when
# this instance cannot do it (so the cascade moves on). A real failure throws.
function Set-GroupHook {
  # The group itself resolved above, so a 403/404 here means group webhooks are
  # not licensed on this instance, not a bad path.
  $probe = Invoke-Api -Method Get -Uri "$GitLabApi/groups/$($g.id)/hooks"
  if ($probe.Status -eq 403 -or $probe.Status -eq 404) {
    Write-Host "group webhooks unavailable ($($probe.Status)) - Premium feature, this instance is CE/Free." -ForegroundColor Yellow
    return $false
  }
  if (-not $probe.Ok) { throw "group hooks probe failed ($($probe.Status)) $($probe.Err)" }
  Register-Hook -Base "$GitLabApi/groups/$($g.id)/hooks" -Label "group $($g.full_path)"
  return $true
}

function Set-SystemHook {
  $probe = Invoke-Api -Method Get -Uri "$GitLabApi/hooks"
  if ($probe.Status -eq 401 -or $probe.Status -eq 403 -or $probe.Status -eq 404) {
    Write-Host "system hooks unavailable ($($probe.Status)) - needs an instance admin token." -ForegroundColor Yellow
    return $false
  }
  if (-not $probe.Ok) { throw "system hooks probe failed ($($probe.Status)) $($probe.Err)" }
  Register-Hook -Base "$GitLabApi/hooks" -Label "system hook"
  return $true
}

function Set-ProjectHooks {
  $pr = Invoke-Api -Method Get -Uri "$GitLabApi/groups/$($g.id)/projects?include_subgroups=true&per_page=100"
  if (-not $pr.Ok) { throw "list projects failed ($($pr.Status)) $($pr.Err)" }
  if (-not $pr.Data) {
    Write-Host "no repos under '$Group' yet - order a service first, then rerun" -ForegroundColor Yellow
    return $true
  }
  foreach ($p in $pr.Data) {
    Register-Hook -Base "$GitLabApi/projects/$($p.id)/hooks" -Label $p.path_with_namespace
  }
  return $true
}

$order = if ($Scope -eq "auto") { @("group", "system", "project") } else { @($Scope) }
$used = $null
foreach ($s in $order) {
  $ok = switch ($s) {
    "group"   { Set-GroupHook }
    "system"  { Set-SystemHook }
    "project" { Set-ProjectHooks }
  }
  if ($ok) { $used = $s; break }
}
if (-not $used) { throw "no usable webhook scope (tried: $($order -join ', ')). Check the token's rights." }

Write-Host ""
Write-Host "scope: $used" -ForegroundColor Cyan
if ($used -eq "project") {
  Write-Host "per-repo hooks: RERUN after ordering a new service, its repo has no hook until then." -ForegroundColor Yellow
} else {
  Write-Host "one hook covers repos created later too - no rerun after ordering a service." -ForegroundColor Cyan
}
Write-Host "restart the portal with GITLAB_WEBHOOK_TOKEN=$Secret (run-oidc.ps1 sets it for -RealGitlab)." -ForegroundColor Cyan
