# Builds the portal into tmp\portal.exe with the version stamped in.
#
# Called by air on every rebuild (see .air.toml), and usable by hand. The stamp
# is what fills the "About" page and what the update notification names, so a
# watched portal reports the same version a `go run` one does - "dev" would make
# both of them go quiet.
$ErrorActionPreference = "Stop"
# Repo root = two levels up (deployments/scripts/ -> deployments/ -> repo).
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

$pkg = "console/internal/buildinfo"
$version = (& git -C $root describe --tags --always --dirty 2>$null)
if (-not $version) { $version = "dev" }
$commit = (& git -C $root rev-parse --short HEAD 2>$null)
$date = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
$ldflags = "-X $pkg.Version=$version -X $pkg.Commit=$commit -X $pkg.Date=$date"

Push-Location $root
try {
  go build -ldflags $ldflags -o tmp\portal.exe .\cmd\portal
} finally {
  Pop-Location
}
