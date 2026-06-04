# Apply the bootstrap ApplicationSet (Step A: one team's chart repo).
$ErrorActionPreference = "Stop"
kubectl apply -f "$PSScriptRoot\applicationset.yaml" | Out-Host
if ($LASTEXITCODE -ne 0) { throw "applicationset apply failed" }
Write-Host "[appset] applied. Watch: kubectl get applications -n argocd -l managed-by=portal -w"
