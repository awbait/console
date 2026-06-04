# Print the Argo CD admin password and mint a long-lived ARGOCD_TOKEN for the
# portal. Uses the REST API directly (no argocd CLI). The admin account must have
# the apiKey capability (set by 20-argocd.ps1).
$ErrorActionPreference = "Stop"
$base = "http://host.docker.internal:8083"

$pwB64 = kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}'
if (-not $pwB64) { throw "argocd-initial-admin-secret not found (is Argo CD installed?)" }
$pw = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($pwB64))
Write-Host "[token] Argo CD admin password: $pw"

$sess = Invoke-RestMethod -Method Post -Uri "$base/api/v1/session" `
    -ContentType "application/json" -Body (@{ username = "admin"; password = $pw } | ConvertTo-Json)
$hdr = @{ Authorization = "Bearer $($sess.token)" }
$tok = Invoke-RestMethod -Method Post -Uri "$base/api/v1/account/admin/token" `
    -Headers $hdr -ContentType "application/json" -Body "{}"

Write-Host ""
Write-Host "ARGOCD_TOKEN=$($tok.token)"
Write-Host ""
Write-Host "[token] Put it in deployments/.env (ARGOCD_TOKEN=...) then run 'make up-upstreams'."
