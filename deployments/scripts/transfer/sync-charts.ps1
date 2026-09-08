<#
.SYNOPSIS
  Carries the Helm charts from the console-charts GitHub repo into the stand's
  GitLab, and optionally straight on into Harbor.

.DESCRIPTION
  console-charts publishes no releases and no tags: the charts live on a branch,
  and each chart carries its own SemVer in its Chart.yaml. So the unit of
  transfer here is a chart, not a release, and "already carried" means "the
  GitLab copy matches the GitHub one", give or take the two rewrites below.

  On the GitLab side every chart has its own project, and some of them have a
  locally rewritten values.yaml holding the installation's base values. Those
  files are named in the `keep` list and survive the sync untouched; everything
  else in the project is replaced by the GitHub version.

  The other rewrite is dependencies. On GitHub the charts sit side by side in
  one repo, so a dependency there is `file://../<chart>`; one chart per GitLab
  project leaves nothing for that path to point at. So every such reference is
  repointed at the dependency's Harbor project, which is where the GitLab
  pipeline, and -PushToHarbor, resolve it from. The dependency has to be in
  Harbor first: the map is in dependency order for that reason.

    download the GitHub zip -> per chart: clone GitLab -> replace all but
    `keep` -> repoint dependencies at Harbor -> nothing changed? no MR ->
    branch + commit + push with an MR (-AutoMerge lets GitLab merge it on a
    green pipeline) -> optionally helm dependency update + package + push to
    Harbor -> clean up.

  GitLab and Harbor are asked separately. A chart GitLab already holds gets no
  MR, and with -PushToHarbor the run still goes on to Harbor: the chart may
  never have reached it, or be there in a copy somebody wants replaced.

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

.PARAMETER ConfigPath
  The chart map to read. Without it: $env:CHARTS_MAP, then a charts-map.json
  sitting next to the console folder, then the template shipped in this
  directory.

  Keep the filled-in map next to the console folder rather than inside the
  repository. update-repos.ps1 replaces the repository whole, so a map kept
  inside it is thrown away on the next update, projects and all.

.PARAMETER DryRun
  Print the resolved plan (chart, GitLab project, kept files, version, what
  differs) and change nothing anywhere.

.PARAMETER PushToHarbor
  Also package the chart and push it to Harbor, instead of leaving that to the
  GitLab pipeline.

.PARAMETER AutoMerge
  Ask GitLab to merge each MR by itself once its pipeline passes, instead of
  leaving it for a person. The MR is still opened and still shows what is going
  into the contour; nobody has to press the button.

  This needs the chart project to have a pipeline: with none to wait for,
  GitLab has no green to merge on and the MR stays open. That is the same
  condition -PushToHarbor exists for, so the two together are a contradiction
  and the script says so.

.PARAMETER Force
  Overwrite an existing sync branch, and push to Harbor over a version that is
  already there.

  The second half is the one to reach for when a chart is unchanged everywhere
  and the copy in Harbor still has to be replaced: with -PushToHarbor the chart
  is packaged from the synced content and pushed over the existing tag. Harbor
  keeps the old artifact, untagged, until the registry's garbage collection
  takes it.

.EXAMPLE
  powershell -File deployments\scripts\transfer\sync-charts.ps1 -DryRun

.EXAMPLE
  powershell -File deployments\scripts\transfer\sync-charts.ps1 -Charts ingress-gateway

.EXAMPLE
  powershell -File deployments\scripts\transfer\sync-charts.ps1 -PushToHarbor -InsecureTls

.EXAMPLE
  powershell -File deployments\scripts\transfer\sync-charts.ps1 -AutoMerge
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
  [switch]   $AutoMerge,
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

# Where the chart map is looked for, in order: -ConfigPath, $env:CHARTS_MAP, a
# charts-map.json sitting next to the repository folder, and finally the
# template shipped in this directory.
#
# The third one is the one that matters. update-repos.ps1 replaces the whole
# console folder to bring it up to date, so a map filled in inside the
# repository is thrown away with everything else, and the next transfer starts
# by asking for projects that were named weeks ago. One level up, in the folder
# holding console and console-charts, nothing touches it.
if (-not $ConfigPath) { $ConfigPath = $env:CHARTS_MAP }
if (-not $ConfigPath) {
  # <repo>\deployments\scripts\transfer -> <repo> -> the folder holding it.
  $repoRoot  = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
  $besideDir = if ($repoRoot) { Split-Path -Parent $repoRoot } else { $null }
  if ($besideDir) {
    $beside = Join-Path $besideDir 'charts-map.json'
    if (Test-Path $beside) { $ConfigPath = $beside }
  }
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

# The dependencies of a chart, as name and version. Same reasoning as
# Get-ChartMeta: a block written by us, read two fields deep, does not justify a
# YAML parser. The block ends at the next top-level key.
function Get-ChartDependencies {
  param([string]$ChartDir)
  $file = Join-Path $ChartDir 'Chart.yaml'
  if (-not (Test-Path $file)) { return @() }

  $deps    = @()
  $current = $null
  $inBlock = $false
  foreach ($line in (Get-Content -Path $file -Encoding UTF8)) {
    if (-not $inBlock) {
      if ($line -match '^dependencies:') { $inBlock = $true }
      continue
    }
    if ($line -match '^\s*$' -or $line -match '^\s*#') { continue }
    if ($line -match '^[^\s-]') { break }
    if ($line -match '^\s*-\s*name:\s*(.+)$') {
      if ($current) { $deps += $current }
      $current = [pscustomobject]@{ Name = $Matches[1].Trim().Trim('"', "'"); Version = '' }
      continue
    }
    if ($current -and $line -match '^\s*version:\s*(.+)$') {
      $current.Version = $Matches[1].Trim().Trim('"', "'")
    }
  }
  if ($current) { $deps += $current }
  # Plain return, and the caller wraps the result in @(). The comma idiom that
  # keeps a one-element array from unrolling turns an empty one into an array
  # holding an empty array, and the caller then walks a phantom dependency with
  # no name - which read as "this chart's dependency is not in Harbor" for every
  # chart that has none.
  return $deps
}

# Where a chart lives in Harbor: its own harborProject if the map gives it one,
# the shared default otherwise.
function Get-HarborProject {
  param([object]$Config, [string]$ChartName)
  $entry = $Config.charts.$ChartName
  if ($entry -and $entry.PSObject.Properties.Name -contains 'harborProject' -and $entry.harborProject) {
    return $entry.harborProject
  }
  return $Config.harborProject
}

# On GitHub every chart sits next to its siblings in one repo, so a dependency
# there reads `file://../<chart>`. In GitLab each chart is a project of its own
# and that sibling directory does not exist, so the reference is repointed at
# Harbor on the way over: the dependency is published there as an OCI chart, and
# `name:` still names it, so the repository is the project, without the chart.
function Convert-DependenciesToOci {
  param([string]$ChartDir, [object]$Config)
  $file = Join-Path $ChartDir 'Chart.yaml'
  if (-not (Test-Path $file)) { return @() }

  $text = Get-Content -Path $file -Raw -Encoding UTF8
  $hits = ([regex] 'file://\.\./(?<dep>[A-Za-z0-9._-]+)').Matches($text)
  if ($hits.Count -eq 0) { return @() }

  $repointed = @()
  $sb  = New-Object Text.StringBuilder
  $pos = 0
  foreach ($hit in $hits) {
    $dep    = $hit.Groups['dep'].Value
    $target = "oci://$($Config.harborHost)/$(Get-HarborProject -Config $Config -ChartName $dep)"
    [void]$sb.Append($text.Substring($pos, $hit.Index - $pos))
    [void]$sb.Append($target)
    $pos = $hit.Index + $hit.Length
    $repointed += [pscustomobject]@{
      Name   = $dep
      Target = $target
      Known  = [bool]($Config.charts.PSObject.Properties.Name -contains $dep)
    }
  }
  [void]$sb.Append($text.Substring($pos))

  # Written back byte for byte apart from the replaced references. Set-Content
  # would also rewrite every line ending and add a BOM, and that diff would bury
  # the one line that actually changed.
  [IO.File]::WriteAllText($file, $sb.ToString(), (New-Object Text.UTF8Encoding($false)))
  return ,$repointed
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
# Which map this run is reading. There are up to four places it could have come
# from, and the difference between them is a transfer that goes somewhere else.
Write-Skip "chart map: $ConfigPath"

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
  $hint = "Fill in 'project' for them in $ConfigPath."
  # The template inside the repository is the wrong copy to fill in: the next
  # update-repos.ps1 run replaces that folder and the answers go with it.
  if ($ConfigPath -eq (Join-Path $PSScriptRoot 'charts-map.json')) {
    $hint = "This is the template shipped with the repository, and updating the repository replaces it. Copy it next to the console folder, fill in 'project' there, and it will be picked up on its own."
  }
  throw "no GitLab project set for: $($unmapped -join ', '). $hint"
}

# --- preflight --------------------------------------------------------------

if (-not (Test-Command 'git')) { throw 'git is not on PATH.' }
if ($PushToHarbor -and -not (Test-Command 'helm')) {
  throw 'helm is not on PATH, and -PushToHarbor needs it. Install helm or drop the flag and let the GitLab pipeline publish.'
}
# -PushToHarbor is for a project with no pipeline; -AutoMerge waits for one to
# go green. Asked for together they describe two different projects, and the MR
# would sit open waiting for a pipeline that never runs. Said, not refused: a
# run may cover several charts, and only some of them may be in that state.
if ($AutoMerge -and $PushToHarbor) {
  Write-Warn '-AutoMerge waits for a pipeline, -PushToHarbor is for projects that have none. An MR in such a project will stay open.'
}

if (-not $DryRun) {
  if (-not $GitLabToken) { $GitLabToken = $env:GITLAB_TOKEN }
  if (-not $GitLabToken) {
    throw 'no GitLab token: pass -GitLabToken or set $env:GITLAB_TOKEN. It needs the write_repository scope and at least Developer in every chart project; -AutoMerge additionally needs the right to merge into the target branch.'
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
        Write-Warn "cannot clone $remote (branch $targetBranch). Does the project exist, and does the token reach it with at least Developer?"
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

    # Repointed after the kept files are back, so a Chart.yaml that GitLab owns
    # gets the same treatment as one that arrived from GitHub, and before the
    # diff below, so "nothing changed" is judged on what will be committed.
    foreach ($dep in @(Convert-DependenciesToOci -ChartDir $clone -Config $cfg)) {
      if ($dep.Known) {
        Write-Ok "dependency $($dep.Name) -> $($dep.Target)"
      } else {
        Write-Warn "dependency $($dep.Name) is not in the map; repointed at the default project: $($dep.Target)"
      }
    }

    Invoke-Native -Exe 'git' -Arguments @('-C', $clone, 'add', '-A') -What 'git add' | Out-Null
    $changes = & git -C $clone status --porcelain

    # "GitLab already holds this chart" is a reason not to open an MR, and only
    # that. Harbor is a separate question and can answer differently: the chart
    # may never have reached it (a pipeline that failed), or be there in a copy
    # somebody wants replaced. So with -PushToHarbor the run carries on to that
    # half, where the version check - and -Force - decide on their own.
    $nothingToCommit = -not $changes
    if ($nothingToCommit) {
      Write-Skip 'GitLab already holds this chart, nothing to sync'
      $upToDate += $chart
      if (-not $PushToHarbor) { continue }
    } else {
      Write-Ok "$(@($changes).Count) file(s) differ:"
      foreach ($line in @($changes) | Select-Object -First 20) { Write-Host "      $line" }
      if (@($changes).Count -gt 20) { Write-Host "      ... and $(@($changes).Count - 20) more" }
    }

    if ($DryRun) {
      if ($nothingToCommit) {
        Write-Skip 'dry run: nothing to sync to GitLab, Harbor would be checked'
      } elseif ($AutoMerge) {
        Write-Skip 'dry run: no branch, no commit, no push (the MR would be set to merge on a green pipeline)'
        $synced += $chart
      } else {
        Write-Skip 'dry run: no branch, no commit, no push'
        $synced += $chart
      }
      continue
    }

    # --- branch, commit, MR ---
    if (-not $nothingToCommit) {
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
        '-o', 'merge_request.remove_source_branch'
      )
      # GitLab merges the MR itself once the pipeline is green. Asked for on the
      # push rather than through the API afterwards: one call, and nothing is
      # merged that the project's own checks have not passed.
      if ($AutoMerge) { $pushArgs += @('-o', 'merge_request.merge_when_pipeline_succeeds') }
      $pushArgs += @('origin', "HEAD:refs/heads/$branch")
      Write-Step "$chart : pushing $branch and opening an MR"
      # GitLab prints the MR URL as a remote message; it is left on the console
      # rather than captured, so the link stays clickable.
      & git @pushArgs
      if ($LASTEXITCODE -ne 0) {
        Write-Warn "push failed. If $branch already exists on the remote, rerun with -Force."
        $failed += "${chart}: push failed"
        continue
      }
      if ($AutoMerge) {
        Write-Ok "$branch pushed, MR opened against $targetBranch and set to merge on a green pipeline"
      } else {
        Write-Ok "$branch pushed, MR opened against $targetBranch"
      }
      $synced += $chart
    } # end of the GitLab half, skipped when GitLab already holds the chart

    # --- optional: straight into Harbor ---
    if ($PushToHarbor) {
      $ociRepo = "oci://$harborHost/$(Get-HarborProject -Config $cfg -ChartName $chart)"

      $showArgs = @('show', 'chart', "$ociRepo/$($meta.Name)", '--version', $meta.Version)
      if ($InsecureTls) { $showArgs += '--insecure-skip-tls-verify' }
      Invoke-Quiet helm $showArgs | Out-Null
      if ($LASTEXITCODE -eq 0 -and -not $Force) {
        Write-Skip "$ociRepo/$($meta.Name):$($meta.Version) is already in Harbor, not pushing"
        continue
      }

      # The dependencies now point at Harbor, so they have to be there before
      # this chart can be packaged. A full run publishes them first - the map is
      # in dependency order - so this bites a run narrowed to one chart, and
      # helm would report it from three levels down.
      $deps    = @(Get-ChartDependencies -ChartDir $clone)
      $missing = @()
      foreach ($dep in $deps) {
        $depRepo = "oci://$harborHost/$(Get-HarborProject -Config $cfg -ChartName $dep.Name)"
        $depArgs = @('show', 'chart', "$depRepo/$($dep.Name)", '--version', $dep.Version)
        if ($InsecureTls) { $depArgs += '--insecure-skip-tls-verify' }
        Invoke-Quiet helm $depArgs | Out-Null
        if ($LASTEXITCODE -ne 0) { $missing += "$($dep.Name) $($dep.Version) ($depRepo)" }
      }
      if ($missing) {
        Write-Warn "not in Harbor yet: $($missing -join '; '). Transfer those charts first, then rerun this one."
        $failed += "${chart}: dependency missing in Harbor"
        continue
      }

      if ($deps) {
        # Fetches the dependencies into charts/ and writes Chart.lock, neither of
        # which is committed: the push above already happened, and upstream keeps
        # both out of git. --skip-refresh because the dependencies are OCI and
        # nothing here needs the user's chart repository cache, which on a stand
        # machine is as likely as not to be stale.
        Write-Step "$chart : helm dependency update"
        $updateArgs = @('dependency', 'update', $clone, '--skip-refresh')
        if ($InsecureTls) { $updateArgs += '--insecure-skip-tls-verify' }
        Invoke-Native -Exe 'helm' -Arguments $updateArgs -What 'helm dependency update' | Out-Null
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
