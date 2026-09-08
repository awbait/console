<#
.SYNOPSIS
  Refreshes the local copies of the console and console-charts repositories in
  the folder this script is run from.

.DESCRIPTION
  The transfer machine keeps both repositories side by side, and the other two
  scripts here are run out of that copy. This one brings them up to date.

    <folder this is run from>\
      console\
      console-charts\

  The source arrives as a zip archive over plain https, the same way
  sync-charts.ps1 takes it: these machines have no git and no ssh access to
  GitHub, and a read-only tree is all the transfer needs. So a copy here is not
  a clone and cannot be pulled - it is replaced whole.

  "Already there" is the normal case, so the work is skipped when there is
  nothing to do. Each copy carries a stamp file naming the commit it was
  unpacked from; when the ref still points at that commit, the repository is
  left alone. -Force downloads it again anyway.

  Replacing is a swap, not an overwrite: the new tree is unpacked next to the
  old one and moved into place only once it is whole, and the old copy is put
  aside as <repo>.previous first. So an interrupted download leaves the working
  copy untouched, and a bad one is a rename away from undone (-Keep leaves that
  copy behind instead of deleting it).

  This script lives inside the console repository and updates it, which Windows
  allows: the host reads a .ps1 in full before running it and holds no handle on
  the file. What it does not allow is renaming a folder somebody is standing in,
  so console is done last and the script works from the parent folder. A shell,
  an editor or a file manager sitting inside one of these folders will stop the
  swap, and the script says which folder that was.

  A copy that turns out to be a git working copy (it has a .git) is left alone:
  replacing it would throw away the history and whatever is uncommitted in it.
  Update that one with git, or pass -Force to replace it like any other.

.PARAMETER Path
  The folder holding the copies. Default: the current directory, which is where
  this is meant to be run from.

.PARAMETER Repos
  Only these repositories, by folder name. Default: console-charts and console.

.PARAMETER Ref
  Branch or tag to take. Default: main.

.PARAMETER Owner
  GitHub owner of both repositories. Default: awbait.

.PARAMETER Force
  Download again even when the copy is already at that commit, and replace a
  copy that is a git working copy.

.PARAMETER Keep
  Keep the replaced copy as <repo>.previous instead of deleting it.

.EXAMPLE
  powershell -File console\deployments\scripts\transfer\update-repos.ps1

.EXAMPLE
  powershell -File console\deployments\scripts\transfer\update-repos.ps1 -Repos console-charts

.EXAMPLE
  powershell -File console\deployments\scripts\transfer\update-repos.ps1 -Ref v0.12.0 -Repos console -Keep
#>
[CmdletBinding()]
param(
  [string]   $Path,
  [string[]] $Repos,
  [string]   $Ref = 'main',
  [string]   $Owner = 'awbait',
  [switch]   $Force,
  [switch]   $Keep
)

$ErrorActionPreference = 'Stop'

# What stops this script is almost always the environment, not the script: no
# network, a folder somebody is standing in, a ref that does not exist. The
# operator needs that sentence, and a PowerShell position line above it buries
# it. Cleanup still runs: finally blocks unwind first.
trap {
  Write-Host ''
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

function Write-Step { param([string]$Text) Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Text) Write-Host "    $Text" -ForegroundColor Green }
function Write-Skip { param([string]$Text) Write-Host "    $Text" -ForegroundColor DarkGray }
function Write-Warn { param([string]$Text) Write-Host "    $Text" -ForegroundColor Yellow }

function Test-Command {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

# Runs a native command whose failure is an answer rather than a fault. Returns
# its stdout; the caller reads $LASTEXITCODE. The plain `& exe ... 2>$null` this
# replaces looks equivalent and is not: in Windows PowerShell, redirecting a
# native command's stderr turns every line it writes into a NativeCommandError,
# and under $ErrorActionPreference = 'Stop' that error is terminating.
function Invoke-Quiet {
  param([string]$Exe, [string[]]$Arguments)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Exe @Arguments 2>$null } finally { $ErrorActionPreference = $prev }
}

# The commit a ref points at. gh when it is installed and signed in, the public
# API otherwise: these repositories are public and the archive below is fetched
# anonymously too, so a machine without gh is not a machine without this script.
function Get-CommitSha {
  param([string]$Repo, [string]$Reference)

  if (Test-Command 'gh') {
    $sha = Invoke-Quiet gh @('api', "repos/$Repo/commits/$Reference", '--jq', '.sha')
    if ($LASTEXITCODE -eq 0 -and $sha) { return "$sha".Trim() }
  }

  # A ref that is not there comes back as an HTTP error, and the raw sentence
  # for it names a status code and nothing the operator can act on.
  try {
    $commit = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/commits/$Reference" `
      -Headers @{ 'User-Agent' = 'console-update-repos' }
  } catch {
    throw "could not resolve $Repo@$Reference : $($_.Exception.Message). Check the branch or tag name, and that this machine reaches api.github.com."
  }
  if (-not $commit.sha) { throw "could not resolve $Repo@$Reference" }
  return $commit.sha
}

# The stamp a copy carries: which repository, ref and commit it was unpacked
# from. Written only after the swap, so a copy that was replaced halfway (there
# is no such case, but a disk can fill) never claims to be current.
$stampName = '.transfer-source.json'

function Get-Stamp {
  param([string]$Dir)
  $file = Join-Path $Dir $stampName
  if (-not (Test-Path $file)) { return $null }
  try { return Get-Content -Path $file -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return $null }
}

function Set-Stamp {
  param([string]$Dir, [string]$Repo, [string]$Reference, [string]$Sha)
  $stamp = [ordered]@{
    repo       = $Repo
    ref        = $Reference
    sha        = $Sha
    downloaded = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  }
  $file = Join-Path $Dir $stampName
  $stamp | ConvertTo-Json | Set-Content -Path $file -Encoding UTF8
}

# --- where we work ----------------------------------------------------------

if (-not $Path) { $Path = (Get-Location).Path }
$Path = (Resolve-Path -LiteralPath $Path).Path

# Stand outside the folders about to be swapped: Windows refuses to rename a
# directory that any process has as its current directory, and this process is
# the one most likely to be sitting in it.
Set-Location -LiteralPath $Path

# console-charts first, console last: this script lives in console, and the
# folder it lives in is the one being renamed at that point. Renaming it is
# allowed (the host has already read this file and closed it), but leaving it
# for last keeps the rest of the run out of that question entirely.
$defaultRepos = @('console-charts', 'console')
if (-not $Repos) { $Repos = $defaultRepos }

# Everything temporary is created inside $Path rather than in $env:TEMP: the
# final step is a directory move, and a move between volumes is a copy the
# operator pays for, or an outright failure. Same folder, same volume, instant.
#
# The name is short on purpose, and the archive is unpacked straight into it.
# Windows PowerShell cannot write a path over 260 characters, GitHub names the
# folder inside the archive <repo>-<40 hex digits>, and the deepest file in
# these repositories adds another 70. Every character spent here comes out of
# what is left for the folder the operator chose.
$workDir = Join-Path $Path ('.upd-' + [Guid]::NewGuid().ToString('N').Substring(0, 6))

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$updated  = @()
$upToDate = @()
$skipped  = @()

try {
  New-Item -ItemType Directory -Path $workDir | Out-Null

  foreach ($name in $Repos) {
    $repo   = "$Owner/$name"
    $target = Join-Path $Path $name
    Write-Step "$repo -> $target"

    if ((Test-Path (Join-Path $target '.git')) -and -not $Force) {
      Write-Warn "$name is a git working copy, leaving it alone. Update it with git, or pass -Force to replace it."
      $skipped += $name
      continue
    }

    $sha = Get-CommitSha -Repo $repo -Reference $Ref
    $short = $sha.Substring(0, 7)

    $stamp = Get-Stamp -Dir $target
    if ($stamp -and $stamp.sha -eq $sha -and -not $Force) {
      Write-Skip "already at $Ref $short"
      $upToDate += $name
      continue
    }
    if ($stamp -and $stamp.sha -eq $sha) {
      Write-Ok "$Ref is still at $short, downloading it again because -Force says so"
    } elseif ($stamp) {
      Write-Ok "$Ref moved $($stamp.sha.Substring(0, 7)) -> $short"
    } elseif (Test-Path $target) {
      Write-Ok "$Ref is at $short (the copy on disk does not say where it came from, replacing it)"
    } else {
      Write-Ok "$Ref is at $short (no copy yet)"
    }

    # Progress rendering makes Invoke-WebRequest an order of magnitude slower.
    $zip = Join-Path $workDir "$name.zip"
    $prevProgress = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    try {
      Invoke-WebRequest -Uri "https://github.com/$repo/archive/$sha.zip" -OutFile $zip -UseBasicParsing
    } finally {
      $ProgressPreference = $prevProgress
    }

    # The archive holds a single top directory named <repo>-<sha>; that is the tree.
    # Over 260 characters Expand-Archive fails on whichever file crossed the line
    # and reports it as "cannot find path", which sends the reader looking for a
    # missing file. Say what actually happened instead.
    try {
      Expand-Archive -Path $zip -DestinationPath $workDir
    } catch {
      throw "could not unpack $repo@$short into $workDir : $($_.Exception.Message). A path over 260 characters does this; run from a folder with a shorter name."
    }
    Remove-Item -Path $zip -Force
    $fresh = (Get-ChildItem -Path $workDir -Directory -Filter "$name-*" | Select-Object -First 1).FullName
    if (-not $fresh) { throw "the archive of $repo@$short unpacked into nothing" }
    Write-Ok 'archive unpacked'

    # The swap. The old copy goes aside first, so the moment the new tree takes
    # the name there is a whole tree under it either way.
    $previous = Join-Path $Path "$name.previous"
    if (Test-Path $previous) { Remove-Item -Path $previous -Recurse -Force }
    if (Test-Path $target) {
      try {
        Move-Item -LiteralPath $target -Destination $previous
      } catch {
        throw "cannot replace $name : something is holding it open. Close any shell, editor or file manager standing in $target and run this again."
      }
    }
    Move-Item -LiteralPath $fresh -Destination $target
    Set-Stamp -Dir $target -Repo $repo -Reference $Ref -Sha $sha

    if ((Test-Path $previous) -and -not $Keep) {
      Remove-Item -Path $previous -Recurse -Force
    } elseif (Test-Path $previous) {
      Write-Ok "previous copy kept as $name.previous"
    }
    Write-Ok "updated to $short"
    $updated += $name
  }
} finally {
  if (Test-Path $workDir) { Remove-Item -Path $workDir -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host ''
Write-Step 'Summary'
if ($updated)  { Write-Ok   ("updated:      " + ($updated  -join ', ')) }
if ($upToDate) { Write-Skip ("already current: " + ($upToDate -join ', ')) }
if ($skipped)  { Write-Warn ("left alone:   " + ($skipped  -join ', ')) }
if (-not $updated -and -not $upToDate -and -not $skipped) { Write-Skip 'nothing to do' }
