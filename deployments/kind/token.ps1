# Print the Argo CD admin password and mint a long-lived ARGOCD_TOKEN for the
# portal. Uses the REST API directly (no argocd CLI). The admin account must have
# the apiKey capability (set by 20-argocd.ps1).
#
# The stand pins the admin password to a known value (below): if neither it nor
# the initial-admin-secret password works (e.g. the password was rotated on a
# previous run), the script resets argocd-secret to the pinned bcrypt hash and
# restarts argocd-server. Dev stand only - do not reuse anywhere real.
$ErrorActionPreference = "Stop"
$base = "http://host.docker.internal:8083"
$adminPw = "admin12345"
# bcrypt("admin12345"), cost 10 ($2y -> $2a for Argo's Go bcrypt).
$adminHash = '$2a$10$akBT/2LHQ5YGbwoEdOxpk.uKfkxTHUmLnYwRxa6mpXo5LKc18X3X2'

function Try-Login([string]$pw) {
    try {
        $sess = Invoke-RestMethod -Method Post -Uri "$base/api/v1/session" `
            -ContentType "application/json" -Body (@{ username = "admin"; password = $pw } | ConvertTo-Json)
        return $sess.token
    } catch { return $null }
}

$pw = $adminPw
$tokSess = Try-Login $adminPw

if (-not $tokSess) {
    # Fresh install: the initial password from the install secret still works.
    $pwB64 = kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' 2>$null
    if ($pwB64) {
        $initPw = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($pwB64))
        $tokSess = Try-Login $initPw
        if ($tokSess) { $pw = $initPw }
    }
}

if (-not $tokSess) {
    Write-Host "[token] stored passwords don't work - resetting admin password to the pinned one..."
    $mtime = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $patch = @{ stringData = @{ "admin.password" = $adminHash; "admin.passwordMtime" = $mtime } } | ConvertTo-Json -Compress
    $f = New-TemporaryFile
    $patch | Set-Content -Path $f -Encoding ascii
    kubectl -n argocd patch secret argocd-secret --type merge --patch-file $f | Out-Host
    Remove-Item $f -ErrorAction SilentlyContinue
    kubectl -n argocd rollout restart deployment argocd-server | Out-Host
    kubectl -n argocd rollout status deployment argocd-server --timeout=120s | Out-Host
    # The server may need a few seconds after rollout before auth works.
    for ($i = 1; $i -le 10; $i++) {
        $tokSess = Try-Login $adminPw
        if ($tokSess) { break }
        Start-Sleep -Seconds 3
    }
    if (-not $tokSess) { throw "still cannot log in to Argo CD as admin after password reset" }
    $pw = $adminPw
}

Write-Host "[token] Argo CD admin password: $pw"

$hdr = @{ Authorization = "Bearer $tokSess" }
$tok = Invoke-RestMethod -Method Post -Uri "$base/api/v1/account/admin/token" `
    -Headers $hdr -ContentType "application/json" -Body "{}"

# Write the token straight into deployments/.env (consumed by `make up-upstreams`)
# so there is no manual copy step. Upsert the ARGOCD_TOKEN line, keep the rest.
$envPath = Join-Path $PSScriptRoot "..\.env"
$tokenLine = "ARGOCD_TOKEN=$($tok.token)"
if (Test-Path $envPath) {
    $kept = @(Get-Content $envPath | Where-Object { $_ -notmatch '^\s*ARGOCD_TOKEN\s*=' })
    Set-Content -Path $envPath -Value ($kept + $tokenLine) -Encoding ascii
} else {
    $header = "# Local stand secrets for ``make up-upstreams``. Regenerate with ``make stand-token``."
    Set-Content -Path $envPath -Value @($header, $tokenLine) -Encoding ascii
}

Write-Host ""
Write-Host "ARGOCD_TOKEN written to deployments/.env (admin password: $pw)"
Write-Host "[token] Next: 'make up-upstreams' then 'make gitlab-seed'."
