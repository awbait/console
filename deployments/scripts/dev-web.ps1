# Runs the frontend dev server (Vite) on :5173, proxying /api to the portal.
# Uses bun; --host binds all interfaces (and IPv4, avoiding the IPv6-only quirk).
# Usage:  .\deployments\scripts\dev-web.ps1
$ErrorActionPreference = "Stop"
# Repo root = two levels up (deployments/scripts/ -> deployments/ -> repo).
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Push-Location (Join-Path $root "web")
try {
  if (-not (Test-Path "node_modules")) { bun install }
  bun run dev --host
} finally {
  Pop-Location
}
