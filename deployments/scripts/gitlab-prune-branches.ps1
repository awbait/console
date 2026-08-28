# Removes the branches the portal left behind in the GitOps repositories.
#
# Every order change rides on a branch of its own (portal/<action>-<service>-<id>,
# see internal/provisioning/service.go). The portal now opens every merge request
# with remove_source_branch, so GitLab drops the branch the moment the change
# lands - but nothing removed the ones created before that, and they are still
# sitting in the repositories, one per edit of every service.
#
# This is that one-off cleanup. A branch under the portal prefix (default
# portal/) is deleted when no open merge request is using it and one of these
# says its content is already in the default branch:
#
#   * a merge request from that branch was merged, or
#   * GitLab reports the branch itself as merged into the default branch.
#
# The first rule is the one that matters on a project that squashes on merge:
# there the branch head never becomes an ancestor of the default branch, so
# GitLab keeps calling the branch unmerged forever.
#
# Left alone, and named in the output instead:
#
#   * a branch whose merge request a person closed without merging. The change
#     is still written there, and only its author can say it can go.
#   * a branch with no merge request on record at all. Nothing says its content
#     went anywhere, so somebody has to look before it is thrown away.
#
# Dry run by default: it prints what it would delete and changes nothing. Pass
# -Apply to actually delete.
#
# Usage:  .\deployments\scripts\gitlab-prune-branches.ps1
#         .\deployments\scripts\gitlab-prune-branches.ps1 -Apply
#         .\deployments\scripts\gitlab-prune-branches.ps1 -GitLabApi https://gitlab.example.com/api/v4 -Token $env:GITLAB_TOKEN -Apply
# Run from the repo root. Defaults match the local stand (deployments/scripts/run-oidc.ps1).
param(
  [string]$GitLabApi = "http://localhost:8929/api/v4",
  [string]$Token     = "glpat-localdev0123456789abcd",
  [string]$Group     = "managed-services",
  [string]$Prefix    = "portal/",
  [switch]$Apply
)
$ErrorActionPreference = "Stop"
$H = @{ "PRIVATE-TOKEN" = $Token }

# Invoke-Api never throws on an HTTP error: one branch that will not go must not
# abort a sweep over all of them, so callers branch on .Ok themselves.
function Invoke-Api {
  param([string]$Method, [string]$Uri)
  try {
    return @{ Ok = $true; Data = (Invoke-RestMethod -Method $Method -Uri $Uri -Headers $H -TimeoutSec 60) }
  } catch {
    $code = 0
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    return @{ Ok = $false; Status = $code; Err = $_.Exception.Message }
  }
}

# Get-Paged walks GitLab's pagination and returns every item of a collection.
function Get-Paged {
  param([string]$Uri)
  $all = @()
  for ($page = 1; ; $page++) {
    $sep = if ($Uri.Contains("?")) { "&" } else { "?" }
    $res = Invoke-Api -Method Get -Uri "$Uri${sep}per_page=100&page=$page"
    if (-not $res.Ok) { throw "GET $Uri failed ($($res.Status)) $($res.Err)" }
    $batch = @($res.Data)
    $all += $batch
    if ($batch.Count -lt 100) { return $all }
  }
}

# Get-SourceBranches returns the source branches of a project's merge requests
# in one state, as a lookup.
function Get-SourceBranches {
  param([int]$ProjectID, [string]$State)
  $set = @{}
  foreach ($mr in Get-Paged -Uri "$GitLabApi/projects/$ProjectID/merge_requests?state=$State") {
    $set[$mr.source_branch] = $true
  }
  return $set
}

$groupPath = [uri]::EscapeDataString($Group)
$projects = @(Get-Paged -Uri "$GitLabApi/groups/$groupPath/projects?include_subgroups=true&archived=false")
Write-Host "Repositories under ${Group}: $($projects.Count)"
if (-not $Apply) { Write-Host "Dry run. Nothing is deleted; pass -Apply to delete." -ForegroundColor Yellow }

$candidates = 0
$deleted    = 0
$failed     = 0
$kept       = 0

foreach ($p in $projects) {
  $branches = @(Get-Paged -Uri "$GitLabApi/projects/$($p.id)/repository/branches" | Where-Object {
    $_.name.StartsWith($Prefix) -and -not $_.default -and -not $_.protected
  })
  if ($branches.Count -eq 0) { continue }

  $opened = Get-SourceBranches -ProjectID $p.id -State "opened"
  $merged = Get-SourceBranches -ProjectID $p.id -State "merged"
  $closed = Get-SourceBranches -ProjectID $p.id -State "closed"

  foreach ($b in $branches) {
    $repo = $p.path_with_namespace
    if ($opened.ContainsKey($b.name)) {
      Write-Host "  keep    $repo $($b.name) (a merge request is still open on it)"
      $kept++
      continue
    }
    if (-not ($merged.ContainsKey($b.name) -or $b.merged)) {
      $reason = if ($closed.ContainsKey($b.name)) { "its merge request was closed without merging" } else { "no merged merge request on record" }
      Write-Host "  keep    $repo $($b.name) ($reason)"
      $kept++
      continue
    }
    $candidates++
    if (-not $Apply) {
      Write-Host "  would delete $repo $($b.name)"
      continue
    }
    $name = [uri]::EscapeDataString($b.name)
    $res = Invoke-Api -Method Delete -Uri "$GitLabApi/projects/$($p.id)/repository/branches/$name"
    if ($res.Ok) {
      $deleted++
      Write-Host "  deleted $repo $($b.name)" -ForegroundColor Green
    } else {
      $failed++
      Write-Host "  FAILED  $repo $($b.name): $($res.Status) $($res.Err)" -ForegroundColor Red
    }
  }
}

if ($Apply) {
  Write-Host "Deleted $deleted of $candidates branches, $failed failed, $kept left alone."
  if ($failed -gt 0) { exit 1 }
} else {
  Write-Host "$candidates branches would be deleted, $kept left alone."
}
