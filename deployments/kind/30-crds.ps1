# Install ONLY the CRDs the ingress-gateway chart needs (Gateway API + Istio),
# without any controllers/webhooks. This lets Argo apply the chart's
# Gateway/xRoute/AuthorizationPolicy resources instead of failing sync with
# "no matches for kind ...". Without an Istio control plane the resources won't
# become programmed, so the app may sit Synced/Progressing rather than Healthy -
# that is accepted for this stand.
$ErrorActionPreference = "Stop"

$gwVersion = "v1.2.1"
# EXPERIMENTAL channel (superset of standard): the ingress-gateway chart renders
# TCPRoute/TLSRoute/UDPRoute/BackendTLSPolicy, which are NOT in standard-install.
Write-Host "[crds] Gateway API $gwVersion (experimental channel: +TCP/TLS/UDP routes)..."
kubectl apply --server-side -f "https://github.com/kubernetes-sigs/gateway-api/releases/download/$gwVersion/experimental-install.yaml" | Out-Host
if ($LASTEXITCODE -ne 0) { throw "gateway-api CRD apply failed" }

Write-Host "[crds] Istio CRDs (crd-all.gen.yaml from istio/base; CRDs only, no controllers/webhooks)..."
# Don't redirect helm's stderr (it prints "already exists" there) - under the
# Stop preference a redirected native stderr would throw. Adding an existing repo
# is a no-op success, so ignore its exit status.
helm repo add istio https://istio-release.storage.googleapis.com/charts | Out-Host
helm repo update istio | Out-Host

# istio/base keeps its CRDs in files/crd-all.gen.yaml (NOT exposed via
# `helm show crds`). Pull + untar, then apply only that file - no validating
# webhook/RBAC, so resources apply even without an Istio control plane.
$tmp = Join-Path $env:TEMP "idp-istio-base"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Path $tmp | Out-Null
helm pull istio/base --untar --untardir $tmp | Out-Host
if ($LASTEXITCODE -ne 0) { throw "helm pull istio/base failed" }
kubectl apply --server-side -f (Join-Path $tmp "base\files\crd-all.gen.yaml") | Out-Host
if ($LASTEXITCODE -ne 0) { throw "istio CRD apply failed" }
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "[crds] done."
