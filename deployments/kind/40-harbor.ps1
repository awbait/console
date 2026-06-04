# Deploy a minimal Harbor into KinD via harbor-helm (replaces the old registry:2
# stand-in). Harbor serves the API v2.0 (portal catalog) AND the OCI registry
# (Argo chart pulls) at host.docker.internal:8084 (NodePort 30084, self-signed
# TLS). See harbor-values.yaml for the trimmed config.
$ErrorActionPreference = "Stop"

# Install only if absent — a re-run leaves the running Harbor untouched rather
# than `helm upgrade`-ing it. Storage is persistent (PVCs), so an upgrade would be
# safe, but skipping it also avoids the ~minute the core needs to re-gate its API
# after a roll (during which project/push calls flap). `make stand-down` (deletes
# the cluster) is the way to get a clean Harbor.
# Use `helm list` (not `helm status`): when the release is absent `helm status`
# exits 1 + writes to stderr, which under ErrorActionPreference=Stop aborts the
# script. `helm list` returns an empty set with exit 0 instead.
$exists = $false
$rels = helm list -q -n harbor
if ($LASTEXITCODE -eq 0 -and (($rels -split "\r?\n") -contains "harbor")) { $exists = $true }

if ($exists) {
    Write-Host "[harbor] release 'harbor' already installed - skipping helm upgrade (run 'make stand-down' to recreate)."
} else {
    Write-Host "[harbor] adding helm repo goharbor..."
    helm repo add harbor https://helm.goharbor.io 2>&1 | Out-Host
    helm repo update harbor | Out-Host

    Write-Host "[harbor] installing release 'harbor' (ns harbor)..."
    helm install harbor harbor/harbor `
        --namespace harbor --create-namespace `
        -f "$PSScriptRoot\harbor-values.yaml" `
        --timeout 10m --wait | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "harbor helm install failed" }
}

# helm --wait already gates on workloads being Ready; now confirm the API answers
# healthy through the published NodePort before the next steps push/create.
Write-Host "[harbor] waiting for API health on https://host.docker.internal:8084 ..."
$healthy = $false
for ($i = 1; $i -le 30; $i++) {
    $status = (curl.exe -sk -o NUL -w "%{http_code}" https://host.docker.internal:8084/api/v2.0/health)
    if ($status -eq "200") { $healthy = $true; break }
    Start-Sleep -Seconds 4
}
if (-not $healthy) { throw "harbor API did not become healthy on :8084 (last code: $status)" }
Write-Host "[harbor] ready (https://host.docker.internal:8084, admin / Harbor12345)"
