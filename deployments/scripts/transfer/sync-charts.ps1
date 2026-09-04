<#
.SYNOPSIS
  Carries the Helm charts from the console-charts GitHub repo into the stand's
  GitLab, and optionally straight on into Harbor.

.DESCRIPTION
  console-charts publishes no releases and no tags: the charts live on a branch,
  and each chart carries its own SemVer in its Chart.yaml. So the unit of
  transfer here is a chart, not a release, and "already carried" means "the
  GitLab copy is byte-identical to the GitHub one".

  On the GitLab side every chart has its own project, and some of them have a
  locally rewritten values.yaml holding the installation's base values. Those
  files are named in the `keep` list and survive the sync untouched; everything
  else in the project is replaced by the GitHub version.

    download the GitHub zip -> per chart: clone GitLab -> replace all but
    `keep` -> nothing changed? skip -> branch + commit + push with an MR ->
    optionally helm package + push to Harbor -> clean up.

  The source arrives as a zip archive over plain https, not as a git clone:
  the machines that run this have no git access to GitHub, and a read-only
  tree is all the sync needs. Git is still required for the GitLab side.

  Where each chart goes is not guessed: charts-map.json states it. A chart with
  an empty `project` is a configuration error and the script says which one.

  The default route to Harbor is the chart project's own GitLab pipeline, which
  runs off the merged MR. -PushToHarbor is for repos that have no pipeline yet:
  the script then packages and pushes the chart itself, from the post-sync
  content, so what lands in Harbor is what GitLab will hold.

.PARAMETER Charts
  Only these charts out of the map. Default: every chart in the map.

.PARAMETER DryRun
  Print the resolved plan (chart, GitLab project, kept files, version, what
  differs) and change nothing anywhere.

.PARAMETER PushToHarbor
  Also package the chart and push it to Harbor, instead of leaving that to the
  GitLab pipeline.

.PARAMETER Force
  Overwrite an existing sync branch, and push to Harbor even when the version is
  already there.

.EXAMPLE
  powershell -File deployments\scripts\transfer\sync-charts.ps1 -DryRun

.EXAMPLE
  powershell -File deployments\scripts\transfer\sync-charts.ps1 -Charts ingress-gateway

.EXAMPLE
  powershell -File deployments\scripts\transfer\sync-charts.ps1 -PushToHarbor -InsecureTls
#>
[CmdletBinding()]
param(
  [string[]] $Charts,
  [string]   $ConfigPath,
  [string]   $GitLabToken,
  [string]   $HarborUser,
  [string]   $HarborPassword,
  [switch]   $PushToHarbor,
  [switch]   $InsecureTls,
  [switch]   $DryRun,
  [switch]   $Force,
  [switch]   $Keep
)

$ErrorActionPreference = 'Stop'

# What stops this script is almost always the environment, not the script: a map
# nobody filled in, a token without access, a host that does not resolve. The
# operator needs the sentence that says so, and a PowerShell position line above
# it buries that sentence. Cleanup still runs: finally blocks unwind first.
trap {
  Write-Host ''
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

if (-not $ConfigPath) { $ConfigPath = Join-Path $PSScriptRoot 'charts-map.json' }

# --- small helpers ----------------------------------------------------------

function Write-Step { param([string]$Text) Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Text) Write-Host "    $Text" -ForegroundColor Green }
function Write-Skip { param([string]$Text) Write-Host "    $Text" -ForegroundColor DarkGray }
function Write-Warn { param([string]$Text) Write-Host "    $Text" -ForegroundColor Yellow }

function Test-Command {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-Native {
  param([string]$Exe, [string[]]$Arguments, [string]$What)
  $out = & $Exe @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$What failed (exit $LASTEXITCODE): $Exe $($Arguments -join ' ')"
  }
  return $out
}

# Runs a native command whose failure is an answer rather than a fault: "is this
# version already in Harbor". Returns its stdout; the caller reads $LASTEXITCODE.
#
# The plain `& exe ... 2>$null` this replaces looks equivalent and is not: in
# Windows PowerShell, redirecting a native command's stderr turns every line it
# writes into a NativeCommandError, and under $ErrorActionPreference = 'Stop'
# that error is terminating - so the command answering "no" killed the script.
function Invoke-Quiet {
  param([string]$Exe, [string[]]$Arguments)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Exe @Arguments 2>$null } finally { $ErrorActionPreference = $prev }
}

# name/version out of a Chart.yaml. A two-field read does not justify a YAML
# parser dependency, and this is the same read 50-charts.ps1 does.
function Get-ChartMeta {
  param([string]$ChartDir)
  $file = Join-Path $ChartDir 'Chart.yaml'
  if (-not (Test-Path $file)) { return $null }
  $name = Select-String -Path $file -Pattern '^name:\s*(.+)$'    | Select-Object -First 1
  $ver  = Select-String -Path $file -Pattern '^version:\s*(.+)$' | Select-Object -First 1
  if (-not $name -or -not $ver) { return $null }
  return [pscustomobject]@{
    Name    = $name.Matches[0].Groups[1].Value.Trim().Trim('"', "'")
    Version = $ver.Matches[0].Groups[1].Value.Trim().Trim('"', "'")
  }
}

# Commit the ref points at, asked over plain https: gh first (it carries auth
# and survives rate limits), the public API as the fallback - the same order
# sync-images.ps1 uses for releases. The source zip is then downloaded by this
# sha, so what lands in GitLab is exactly the commit resolved here.
function Get-CommitSha {
  param([string]$Repo, [string]$Ref)

  if (Test-Command 'gh') {
    $sha = Invoke-Quiet gh @('api', "repos/$Repo/commits/$Ref", '--jq', '.sha')
    if ($LASTEXITCODE -eq 0 -and $sha) { return "$sha".Trim() }
  }

  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $commit = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/commits/$Ref" -Headers @{ 'User-Agent' = 'console-sync-charts' }
  if (-not $commit.sha) { throw "could not resolve $Repo@$Ref" }
  return $commit.sha
}

# --- config -----------------------------------------------------------------

if (-not (Test-Path $ConfigPath)) {
  throw "config not found: $ConfigPath (see README.md in the same directory)"
}
$cfg = Get-Content -Path $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json

$sourceRepo   = $cfg.sourceRepo
$sourceRef    = $cfg.ref
$gitlabUrl    = $cfg.gitlabUrl.TrimEnd('/')
$targetBranch = $cfg.targetBranch
$harborHost   = $cfg.harborHost
$defaultKeep  = @($cfg.keep)

$chartNames = $cfg.charts.PSObject.Properties.Name
if ($Charts) {
  $unknown = $Charts | Where-Object { $chartNames -notcontains $_ }
  if ($unknown) { throw "not in $ConfigPath : $($unknown -join ', ')" }
  $chartNames = $Charts
}
if (-not $chartNames) { throw "no charts in $ConfigPath" }

# An unfilled map is the one mistake that would otherwise push a chart nowhere
# in particular, so it is caught before anything is cloned.
$unmapped = $chartNames | Where-Object { -not $cfg.charts.$_.project }
if ($unmapped) {
  throw "no GitLab project set for: $($unmapped -join ', '). Fill in 'project' for them in $ConfigPath."
}

# --- preflight --------------------------------------------------------------

if (-not (Test-Command 'git')) { throw 'git is not on PATH.' }
if ($PushToHarbor -and -not (Test-Command 'helm')) {
  throw 'helm is not on PATH, and -PushToHarbor needs it. Install helm or drop the flag and let the GitLab pipeline publish.'
}

if (-not $DryRun) {
  if (-not $GitLabToken) { $GitLabToken = $env:GITLAB_TOKEN }
  if (-not $GitLabToken) {
    throw 'no GitLab token: pass -GitLabToken or set $env:GITLAB_TOKEN (a token with write access to the chart projects).'
  }
}
if ($PushToHarbor) {
  if (-not $HarborUser)     { $HarborUser     = $env:HARBOR_USER }
  if (-not $HarborUser)     { $HarborUser     = 'admin' }
  if (-not $HarborPassword) { $HarborPassword = $env:HARBOR_PASSWORD }
  if (-not $HarborPassword) { $HarborPassword = 'Harbor12345' }
}

# --- source -----------------------------------------------------------------

$workDir = Join-Path ([IO.Path]::GetTempPath()) "console-charts-transfer-$PID"
New-Item -ItemType Directory -Path $workDir -Force | Out-Null

$synced   = @()
$upToDate = @()
$failed   = @()
$loggedIn = $false

try {
  Write-Step "Resolving $sourceRepo@$sourceRef"
  $fullSha   = Get-CommitSha -Repo $sourceRepo -Ref $sourceRef
  $sourceSha = $fullSha.Substring(0, 7)
  Write-Ok "$sourceRepo@$sourceRef is at $sourceSha"

  Write-Step 'Downloading the source archive'
  $zip = Join-Path $workDir 'source.zip'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  # Progress rendering makes Invoke-WebRequest an order of magnitude slower.
  $prevProgress = $ProgressPreference
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest -Uri "https://github.com/$sourceRepo/archive/$fullSha.zip" -OutFile $zip -UseBasicParsing
  $ProgressPreference = $prevProgress
  # The archive holds a single top directory named <repo>-<sha>; that is the tree.
  $unpacked = Join-Path $workDir 'source'
  Expand-Archive -Path $zip -DestinationPath $unpacked
  $sourceDir = (Get-ChildItem -Path $unpacked -Directory | Select-Object -First 1).FullName
  if (-not $sourceDir) { throw "the source archive of $sourceRepo@$sourceRef unpacked into nothing" }
  Write-Ok 'source tree unpacked'

  if ($PushToHarbor -and -not $DryRun) {
    Write-Step "helm registry login $harborHost"
    $loginArgs = @('registry', 'login', $harborHost, '-u', $HarborUser, '--password-stdin')
    if ($InsecureTls) { $loginArgs += '--insecure' }
    $HarborPassword | & helm @loginArgs | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "helm registry login to $harborHost failed" }
    $loggedIn = $true
    Write-Ok 'logged in'
  }

  foreach ($chart in $chartNames) {
    $entry   = $cfg.charts.$chart
    $project = $entry.project.Trim('/')
    # Not named $keep: PowerShell variable names are case-insensitive, so that
    # would be the -Keep switch and an array does not go into a switch.
    # A present `keep` always wins over the default, an empty one included:
    # "keep": [] is how a chart says its GitLab values.yaml is disposable and
    # everything gets replaced. Only an absent key falls back to the default.
    $keepFiles = $defaultKeep
    if ($entry.PSObject.Properties.Name -contains 'keep') {
      $keepFiles = @(@($entry.keep) | Where-Object { $_ })
    }

    Write-Host ''
    Write-Step "$chart -> $project"

    $srcChart = Join-Path $sourceDir $chart
    $meta = Get-ChartMeta -ChartDir $srcChart
    if (-not $meta) {
      Write-Warn "no $chart/Chart.yaml in $sourceRepo@$sourceRef, skipping"
      $failed += "${chart}: absent in the source repo"
      continue
    }
    $keepLabel = if ($keepFiles) { $keepFiles -join ', ' } else { 'nothing' }
    Write-Ok "chart version $($meta.Version), keeping: $keepLabel"

    # --- clone the GitLab side ---
    $clone = Join-Path $workDir "gitlab\$chart"
    $remote = "$gitlabUrl/$project.git"
    if (-not $DryRun) {
      # The token rides in the URL of a throwaway clone that is deleted at the
      # end; it is never written to a config the user keeps. Only http(s) takes
      # a token this way - an ssh or file remote authenticates on its own.
      $authRemote = $remote
      $scheme = ([Uri]$gitlabUrl).Scheme
      if ($scheme -eq 'http' -or $scheme -eq 'https') {
        $hostPart = $gitlabUrl.Substring("${scheme}://".Length)
        $authRemote = "${scheme}://oauth2:$GitLabToken@$hostPart/$project.git"
      }
      & git clone --quiet --depth 1 --branch $targetBranch $authRemote $clone
      if ($LASTEXITCODE -ne 0) {
        Write-Warn "cannot clone $remote (branch $targetBranch). Does the project exist and does the token have write access?"
        $failed += "${chart}: clone failed"
        continue
      }
    } else {
      Invoke-Quiet git @('clone', '--quiet', '--depth', '1', '--branch', $targetBranch, $remote, $clone) | Out-Null
      if ($LASTEXITCODE -ne 0) {
        Write-Warn "cannot clone $remote anonymously; in a real run the token would be used"
        $failed += "${chart}: clone failed (dry run, no token)"
        continue
      }
    }

    # --- replace everything but the kept files ---
    $stash = Join-Path $workDir "keep\$chart"
    New-Item -ItemType Directory -Path $stash -Force | Out-Null
    $kept = @()
    foreach ($rel in $keepFiles) {
      $from = Join-Path $clone $rel
      if (-not (Test-Path $from)) { continue }
      $to = Join-Path $stash $rel
      New-Item -ItemType Directory -Path (Split-Path $to -Parent) -Force | Out-Null
      Copy-Item -Path $from -Destination $to -Recurse -Force
      $kept += $rel
    }

    Get-ChildItem -Path $clone -Force |
      Where-Object { $_.Name -ne '.git' } |
      Remove-Item -Recurse -Force

    Copy-Item -Path (Join-Path $srcChart '*') -Destination $clone -Recurse -Force

    # Restored last, so the GitLab version wins over the GitHub one. A kept file
    # that GitLab did not have simply arrives from GitHub.
    foreach ($rel in $kept) {
      $from = Join-Path $stash $rel
      $to   = Join-Path $clone $rel
      New-Item -ItemType Directory -Path (Split-Path $to -Parent) -Force | Out-Null
      Copy-Item -Path $from -Destination $to -Recurse -Force
    }

    Invoke-Native -Exe 'git' -Arguments @('-C', $clone, 'add', '-A') -What 'git add' | Out-Null
    $changes = & git -C $clone status --porcelain
    if (-not $changes) {
      Write-Skip 'GitLab already holds this chart, nothing to sync'
      $upToDate += $chart
      continue
    }
    Write-Ok "$(@($changes).Count) file(s) differ:"
    foreach ($line in @($changes) | Select-Object -First 20) { Write-Host "      $line" }
    if (@($changes).Count -gt 20) { Write-Host "      ... and $(@($changes).Count - 20) more" }

    if ($DryRun) {
      Write-Skip 'dry run: no branch, no commit, no push'
      $synced += $chart
      continue
    }

    # --- branch, commit, MR ---
    $branch = "chore/sync-$chart-$($meta.Version)"
    Invoke-Native -Exe 'git' -Arguments @('-C', $clone, 'checkout', '--quiet', '-B', $branch) -What 'git checkout' | Out-Null

    # A shallow throwaway clone has no identity of its own; set one locally so
    # the commit does not fail on a machine with no global user.name.
    & git -C $clone config user.name  'console-transfer'
    & git -C $clone config user.email 'console-transfer@localhost'

    $body = "Source: $sourceRepo@$sourceRef ($sourceSha)."
    if ($kept) { $body += "`nKept from GitLab: $($kept -join ', ')." }
    Invoke-Native -Exe 'git' -Arguments @(
      '-C', $clone, 'commit', '--quiet',
      '-m', "chore($chart): sync chart $($meta.Version) from console-charts",
      '-m', $body
    ) -What 'git commit' | Out-Null

    $pushArgs = @('-C', $clone, 'push')
    if ($Force) { $pushArgs += '--force' }
    $pushArgs += @(
      '-o', 'merge_request.create',
      '-o', "merge_request.target_branch=$targetBranch",
      '-o', "merge_request.title=chore($chart): sync chart $($meta.Version) from console-charts",
      '-o', 'merge_request.remove_source_branch',
      'origin', "HEAD:refs/heads/$branch"
    )
    Write-Step "$chart : pushing $branch and opening an MR"
    # GitLab prints the MR URL as a remote message; it is left on the console
    # rather than captured, so the link stays clickable.
    & git @pushArgs
    if ($LASTEXITCODE -ne 0) {
      Write-Warn "push failed. If $branch already exists on the remote, rerun with -Force."
      $failed += "${chart}: push failed"
      continue
    }
    Write-Ok "$branch pushed, MR opened against $targetBranch"
    $synced += $chart

    # --- optional: straight into Harbor ---
    if ($PushToHarbor) {
      $hProject = $cfg.harborProject
      if ($entry.PSObject.Properties.Name -contains 'harborProject' -and $entry.harborProject) {
        $hProject = $entry.harborProject
      }
      $ociRepo = "oci://$harborHost/$hProject"

      $showArgs = @('show', 'chart', "$ociRepo/$($meta.Name)", '--version', $meta.Version)
      if ($InsecureTls) { $showArgs += '--insecure-skip-tls-verify' }
      Invoke-Quiet helm $showArgs | Out-Null
      if ($LASTEXITCODE -eq 0 -and -not $Force) {
        Write-Skip "$ociRepo/$($meta.Name):$($meta.Version) is already in Harbor, not pushing"
        continue
      }

      Write-Step "$chart : helm package + push to $ociRepo"
      $pkgDir = Join-Path $workDir 'packages'
      New-Item -ItemType Directory -Path $pkgDir -Force | Out-Null
      # Packaged from the clone, so Harbor gets exactly the content GitLab now
      # holds - the kept values.yaml included.
      Invoke-Native -Exe 'helm' -Arguments @('package', $clone, '--destination', $pkgDir) -What 'helm package' | Out-Null
      $tgz = Join-Path $pkgDir "$($meta.Name)-$($meta.Version).tgz"
      if (-not (Test-Path $tgz)) { throw "helm package produced no $tgz" }

      $pushHelm = @('push', $tgz, $ociRepo)
      if ($InsecureTls) { $pushHelm += '--insecure-skip-tls-verify' }
      Invoke-Native -Exe 'helm' -Arguments $pushHelm -What 'helm push' | Out-Null
      Remove-Item $tgz -Force -ErrorAction SilentlyContinue
      Write-Ok "$ociRepo/$($meta.Name):$($meta.Version) is in Harbor"
    }
  }
}
finally {
  if ($loggedIn) { Invoke-Quiet helm @('registry', 'logout', $harborHost) | Out-Null }
  if ($Keep) {
    Write-Host ''
    Write-Skip "-Keep: leaving the clones in $workDir"
  } else {
    Write-Host ''
    Write-Step 'Cleaning up'
    if (Test-Path $workDir) { Remove-Item $workDir -Recurse -Force -ErrorAction SilentlyContinue }
    Write-Ok 'clones and packages removed'
  }
}

Write-Host ''
if ($synced) {
  $verb = 'Synced'
  if ($DryRun) { $verb = 'Would sync' }
  Write-Host "${verb}: $($synced -join ', ')" -ForegroundColor Green
}
if ($upToDate) { Write-Host "Already up to date: $($upToDate -join ', ')" -ForegroundColor DarkGray }
if ($failed) {
  Write-Host 'Not done:' -ForegroundColor Yellow
  foreach ($f in $failed) { Write-Host "  $f" -ForegroundColor Yellow }
  exit 1
}
