# Orchestrate the full KinD + Argo CD + OCI-registry stand bring-up.
# token.ps1 (last step) writes ARGOCD_TOKEN straight into deployments/.env, so
# after this finishes just run:
#   make up-upstreams-infra   (real GitLab + portal in real mode)
#   make gitlab-seed    (once GitLab is healthy)
# See the e2e checklist in deployments/kind/README.md.
$ErrorActionPreference = "Stop"

& "$PSScriptRoot\00-cluster.ps1"
& "$PSScriptRoot\20-argocd.ps1"
& "$PSScriptRoot\10-coredns.ps1"
& "$PSScriptRoot\30-crds.ps1"
& "$PSScriptRoot\35-istio.ps1"
& "$PSScriptRoot\40-harbor.ps1"
& "$PSScriptRoot\45-harbor-project.ps1"
# Seeds Harbor from an external chart dir if STAND_CHARTS_DIR is set; otherwise
# skips (this repo doesn't vendor charts - populate Harbor separately).
& "$PSScriptRoot\50-charts.ps1"
& "$PSScriptRoot\60-argo-repos.ps1"
& "$PSScriptRoot\70-appset.ps1"

Write-Host ""
Write-Host "==================== STAND READY ===================="
& "$PSScriptRoot\token.ps1"
Write-Host ""
Write-Host "Next: 'make up-upstreams-infra' (GitLab + portal in real mode), then 'make gitlab-seed'."
