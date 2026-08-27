<#
.SYNOPSIS
  Carries a console release image from a GitHub Release into the stand's Harbor.

.DESCRIPTION
  The release workflow attaches every image as a `docker load`-able archive
  (console-<component>-<tag>-linux-amd64.tar.gz) so an installation with no
  access to GHCR has something to carry in. This script is the carrying:

    resolve the version -> is it already in Harbor? -> download + verify ->
    docker load -> retag to Harbor -> push -> verify -> clean up.

  Everything is idempotent: a version already present in Harbor is skipped
  unless -Force is given, and every artifact this script creates (the downloaded
  archive, the loaded GHCR image, the Harbor tag) is removed at the end unless
  -Keep is given.

.PARAMETER Version
  Release tag to carry, e.g. v0.8.1. Defaults to the latest published release.

.PARAMETER Components
  Which images to carry. Defaults to both portal and collector. A component
  missing from the release is reported and skipped, not treated as a failure.

.PARAMETER Force
  Push even when the tag is already in Harbor (overwrites it).

.PARAMETER Keep
  Keep the downloaded archives and the local docker images afterwards.

.EXAMPLE
  powershell -File deployments\scripts\transfer\sync-images.ps1

.EXAMPLE
  powershell -File deployments\scripts\transfer\sync-images.ps1 -Version v0.8.1 -Components portal
#>
[CmdletBinding()]
param(
  [string]   $Version,
  [string[]] $Components    = @('portal', 'collector'),
  [string]   $SourceRepo    = 'awbait/console',
  [string]   $HarborHost    = 'harbor.idp.ecpk.test',
  [string]   $HarborProject = 'core',
  [string]   $HarborUser,
  [string]   $HarborPassword,
  [switch]   $Force,
  [switch]   $Keep
)

$ErrorActionPreference = 'Stop'

# What stops this script is almost always the environment, not the script: no
# Docker, no access to Harbor, a release that has no such asset. The operator
# needs the sentence that says so, and a PowerShell position line above it
# buries that sentence. Cleanup still runs: finally blocks unwind first.
trap {
  Write-Host ''
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

# Credentials: parameters win, then the environment, then the stand default.
if (-not $HarborUser)     { $HarborUser     = $env:HARBOR_USER }
if (-not $HarborUser)     { $HarborUser     = 'admin' }
if (-not $HarborPassword) { $HarborPassword = $env:HARBOR_PASSWORD }
if (-not $HarborPassword) { $HarborPassword = 'Harbor12345' }

# --- small helpers ----------------------------------------------------------

function Write-Step { param([string]$Text) Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Text) Write-Host "    $Text" -ForegroundColor Green }
function Write-Skip { param([string]$Text) Write-Host "    $Text" -ForegroundColor DarkGray }

# Runs a native command, throws on a non-zero exit and returns its stdout lines.
function Invoke-Native {
  param([string]$Exe, [string[]]$Arguments, [string]$What)
  $out = & $Exe @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$What failed (exit $LASTEXITCODE): $Exe $($Arguments -join ' ')"
  }
  return $out
}

# Runs a native command whose failure is an answer rather than a fault: "is the
# daemon up", "is the tag already there". Returns its stdout; the caller reads
# $LASTEXITCODE.
#
# The plain `& exe ... 2>$null` this replaces looks equivalent and is not: in
# Windows PowerShell, redirecting a native command's stderr turns every line it
# writes into a NativeCommandError, and under $ErrorActionPreference = 'Stop'
# that error is terminating. So `docker manifest inspect` answering "not found"
# - the normal way to learn a tag is missing - killed the script instead.
function Invoke-Quiet {
  param([string]$Exe, [string[]]$Arguments)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Exe @Arguments 2>$null } finally { $ErrorActionPreference = $prev }
}

function Test-Command {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

# --- preflight: docker ------------------------------------------------------

# Docker has to be both installed and running. On Windows the daemon is Docker
# Desktop, which this can start on its own: the alternative is failing on the
# first `docker load` with a message that does not say what to do about it.
function Assert-Docker {
  if (-not (Test-Command 'docker')) {
    throw "docker is not on PATH. Install Docker Desktop (https://docs.docker.com/desktop/) and reopen the terminal."
  }

  Invoke-Quiet docker @('info', '--format', '{{.ServerVersion}}') | Out-Null
  if ($LASTEXITCODE -eq 0) { return }

  Write-Step 'Docker daemon is not responding, starting Docker Desktop'
  $exe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (Test-Path $exe) {
    Start-Process -FilePath $exe | Out-Null
  } else {
    throw "Docker daemon is not running and Docker Desktop was not found at '$exe'. Start Docker yourself and rerun."
  }

  # Docker Desktop takes a while to hand over a working daemon socket.
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 5
    Invoke-Quiet docker @('info', '--format', '{{.ServerVersion}}') | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Ok 'daemon is up'; return }
    Write-Skip "waiting for the daemon ($(($i + 1) * 5)s)"
  }
  throw 'Docker Desktop did not come up within 5 minutes. Start it yourself and rerun.'
}

# --- release lookup ---------------------------------------------------------

function Get-LatestVersion {
  param([string]$Repo)

  if (Test-Command 'gh') {
    $tag = Invoke-Quiet gh @('release', 'view', '--repo', $Repo, '--json', 'tagName', '-q', '.tagName')
    if ($LASTEXITCODE -eq 0 -and $tag) { return "$tag".Trim() }
  }

  # No gh (or no gh auth): the public releases API answers the same question.
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $api = "https://api.github.com/repos/$Repo/releases/latest"
  $rel = Invoke-RestMethod -Uri $api -Headers @{ 'User-Agent' = 'console-sync-images' }
  if (-not $rel.tag_name) { throw "could not resolve the latest release of $Repo" }
  return $rel.tag_name
}

# Downloads one release asset. gh handles private repos and rate limits better,
# so it is tried first; the plain download URL is the fallback.
function Get-ReleaseAsset {
  param([string]$Repo, [string]$Tag, [string]$Asset, [string]$Destination)

  $target = Join-Path $Destination $Asset
  if (Test-Path $target) { Remove-Item $target -Force }

  if (Test-Command 'gh') {
    Invoke-Quiet gh @('release', 'download', $Tag, '--repo', $Repo, '--pattern', $Asset, '--dir', $Destination) | Out-Null
    if ($LASTEXITCODE -eq 0 -and (Test-Path $target)) { return $target }
  }

  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $url = "https://github.com/$Repo/releases/download/$Tag/$Asset"
  try {
    # Progress rendering makes Invoke-WebRequest an order of magnitude slower.
    $prev = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $url -OutFile $target -UseBasicParsing
    $ProgressPreference = $prev
  } catch {
    return $null
  }
  if (Test-Path $target) { return $target }
  return $null
}

# The release carries SHA256SUMS.txt for all archives. Verifying is cheap and it
# is the only guard against a truncated download turning into a broken image.
function Assert-Checksum {
  param([string]$File, [string]$SumsFile)

  if (-not $SumsFile -or -not (Test-Path $SumsFile)) {
    Write-Skip 'SHA256SUMS.txt is absent in the release, checksum not verified'
    return
  }
  $name = Split-Path $File -Leaf
  $line = Select-String -Path $SumsFile -Pattern $name -SimpleMatch | Select-Object -First 1
  if (-not $line) {
    Write-Skip "$name is not listed in SHA256SUMS.txt, checksum not verified"
    return
  }
  $expected = (($line.Line -split '\s+')[0]).ToLowerInvariant()
  $actual   = (Get-FileHash -Path $File -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($expected -ne $actual) {
    throw "checksum mismatch for ${name}: expected $expected, got $actual"
  }
  Write-Ok 'checksum ok'
}

# --- harbor -----------------------------------------------------------------

function Connect-Harbor {
  param([string]$Registry, [string]$User, [string]$Password)

  # --password-stdin instead of --password: the latter warns and leaves the
  # secret in the process list and the shell history.
  $Password | & docker login $Registry --username $User --password-stdin
  if ($LASTEXITCODE -ne 0) {
    throw "docker login $Registry failed for user '$User'. Check the credentials and that the host resolves."
  }
  Write-Ok "logged in to $Registry as $User"
}

# True when the tag already exists in the registry. Runs after the login, so a
# private project answers honestly instead of looking empty.
function Test-RemoteImage {
  param([string]$Reference)
  Invoke-Quiet docker @('manifest', 'inspect', $Reference) | Out-Null
  if ($LASTEXITCODE -eq 0) { return $true }
  # Harbor on the stand serves a self-signed certificate; if docker was not
  # taught the CA, --insecure is the second chance before calling it absent.
  Invoke-Quiet docker @('manifest', 'inspect', '--insecure', $Reference) | Out-Null
  return ($LASTEXITCODE -eq 0)
}

# --- main -------------------------------------------------------------------

Assert-Docker

if (-not $Version) {
  Write-Step "Resolving the latest release of $SourceRepo"
  $Version = Get-LatestVersion -Repo $SourceRepo
}
if ($Version -notmatch '^v\d+\.\d+\.\d+') {
  throw "'$Version' does not look like a release tag (vX.Y.Z)"
}
Write-Ok "version $Version"

$registry = $HarborHost
Write-Step "Logging in to $registry"
Connect-Harbor -Registry $registry -User $HarborUser -Password $HarborPassword

# What is actually missing there. Asked before downloading anything: on a rerun
# of an already carried release this is where the script stops.
$pending = @()
foreach ($component in $Components) {
  $target = "$registry/$HarborProject/console/${component}:$Version"
  if ((Test-RemoteImage -Reference $target) -and -not $Force) {
    Write-Skip "$target is already in Harbor, skipping"
    continue
  }
  $pending += $component
}
if ($pending.Count -eq 0) {
  Write-Host ''
  Write-Host "Nothing to do: $Version is already in Harbor. Use -Force to push over it." -ForegroundColor Green
  exit 0
}

$workDir = Join-Path ([IO.Path]::GetTempPath()) "console-transfer-$Version-$PID"
New-Item -ItemType Directory -Path $workDir -Force | Out-Null

# Images the script loaded or tagged itself, removed in the finally block so a
# carried release does not leave gigabytes behind on the operator's machine.
$createdImages = @()
$pushed  = @()
$missing = @()

try {
  Write-Step 'Downloading SHA256SUMS.txt'
  $sums = Get-ReleaseAsset -Repo $SourceRepo -Tag $Version -Asset 'SHA256SUMS.txt' -Destination $workDir

  foreach ($component in $pending) {
    $asset  = "console-$component-$Version-linux-amd64.tar.gz"
    $target = "$registry/$HarborProject/console/${component}:$Version"

    Write-Step "$component : downloading $asset"
    $archive = Get-ReleaseAsset -Repo $SourceRepo -Tag $Version -Asset $asset -Destination $workDir
    if (-not $archive) {
      # Older releases predate some components; that is not an error for the
      # ones that are there.
      Write-Skip "$asset is not attached to release $Version, skipping $component"
      $missing += $component
      continue
    }
    Write-Ok ('{0:n1} MB' -f ((Get-Item $archive).Length / 1MB))
    Assert-Checksum -File $archive -SumsFile $sums

    Write-Step "$component : docker load"
    $loaded = Invoke-Native -Exe 'docker' -Arguments @('load', '-i', $archive) -What 'docker load'
    # The source reference comes from what was actually loaded rather than from
    # a hardcoded ghcr.io path, so a change on the publishing side is followed.
    $source = ($loaded | Select-String -Pattern '^Loaded image(?: ID)?:\s*(.+)$' |
               ForEach-Object { $_.Matches[0].Groups[1].Value.Trim() } |
               Select-Object -First 1)
    if (-not $source) { throw "docker load printed no image reference for $asset" }
    Write-Ok $source
    $createdImages += $source

    Write-Step "$component : tagging as $target"
    Invoke-Native -Exe 'docker' -Arguments @('tag', $source, $target) -What 'docker tag' | Out-Null
    $createdImages += $target
    & docker images --filter "reference=$target" --format '{{.Repository}}:{{.Tag}}  {{.Size}}'

    Write-Step "$component : pushing"
    Invoke-Native -Exe 'docker' -Arguments @('push', $target) -What 'docker push' | Out-Null

    if (-not (Test-RemoteImage -Reference $target)) {
      throw "$target is not readable from the registry right after the push"
    }
    Write-Ok "$target is in Harbor"
    $pushed += $target
  }
}
finally {
  if ($Keep) {
    Write-Skip "-Keep: leaving the archives in $workDir and the local images in place"
  } else {
    Write-Step 'Cleaning up'
    foreach ($image in ($createdImages | Select-Object -Unique)) {
      Invoke-Quiet docker @('rmi', $image) | Out-Null
    }
    if (Test-Path $workDir) { Remove-Item $workDir -Recurse -Force -ErrorAction SilentlyContinue }
    Write-Ok 'archives and local images removed'
  }
}

Write-Host ''
if ($pushed.Count -gt 0) {
  Write-Host 'Carried into Harbor:' -ForegroundColor Green
  foreach ($ref in $pushed) { Write-Host "  $ref" }
}
if ($missing.Count -gt 0) {
  Write-Host "Not in release ${Version}: $($missing -join ', ')" -ForegroundColor Yellow
}
