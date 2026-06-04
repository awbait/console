# Create the single-node KinD cluster (idempotent).
$ErrorActionPreference = "Stop"
# `kind get clusters` writes "No kind clusters found." to stderr (exit 0) when
# empty. Swallow stderr at the cmd.exe level so PowerShell's Stop preference
# doesn't turn that benign native stderr into a terminating error.
$clusters = cmd /c "kind get clusters 2>nul"
if ($clusters -contains "idp") {
    Write-Host "[cluster] kind cluster 'idp' already exists - skipping."
} else {
    Write-Host "[cluster] creating kind cluster 'idp'..."
    kind create cluster --name idp --config "$PSScriptRoot\kind-config.yaml"
    if ($LASTEXITCODE -ne 0) { throw "kind create cluster failed" }
}
kubectl config use-context kind-idp | Out-Host
