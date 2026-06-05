# Install an Istio control plane (istiod) + MetalLB so the chart's Gateway
# (gatewayClassName: istio) actually gets ACCEPTED + PROGRAMMED and the ArgoCD
# app can reach Healthy. Without this the Gateway sits "Waiting for controller"
# (no controller) and "AddressNotAssigned" (KinD has no LoadBalancer).
#
# istiod registers the `istio` GatewayClass and provisions an envoy proxy
# (Deployment + LoadBalancer Service) per Gateway. MetalLB hands that Service a
# real IP from the kind docker network, which flips the Gateway to Programmed.
$ErrorActionPreference = "Stop"

# --- istiod (CRDs already installed by 30-crds.ps1; base release not required) ---
helm repo add istio https://istio-release.storage.googleapis.com/charts | Out-Host
helm repo update istio | Out-Host
kubectl create namespace istio-system --dry-run=client -o yaml | kubectl apply -f - | Out-Host
Write-Host "[istio] installing istiod..."
helm upgrade --install istiod istio/istiod -n istio-system --wait --timeout 5m | Out-Host
if ($LASTEXITCODE -ne 0) { throw "istiod install failed" }

# --- MetalLB (gives LoadBalancer Services an address in KinD) ---
Write-Host "[istio] installing MetalLB..."
kubectl apply -f https://raw.githubusercontent.com/metallb/metallb/v0.14.8/config/manifests/metallb-native.yaml | Out-Host
if ($LASTEXITCODE -ne 0) { throw "metallb apply failed" }
kubectl -n metallb-system rollout status deployment controller --timeout=180s | Out-Host
kubectl -n metallb-system rollout status daemonset speaker --timeout=180s | Out-Host

# Address pool from the kind network's IPv4 /16 (e.g. 172.21.0.0/16 -> .255.200-.255.250).
# NOTE: emit one subnet per line ({{println}}) and filter in the pipeline - do NOT
# pass `-split` after the native `docker` call: PowerShell would hand `-split` to
# docker as a flag ("unknown shorthand flag: 's'"), not treat it as an operator.
$sub = (docker network inspect kind --format '{{range .IPAM.Config}}{{println .Subnet}}{{end}}' |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+/\d+$' } | Select-Object -First 1)
if (-not $sub) { throw "could not determine kind network IPv4 subnet" }
$o = $sub.Split('.'); $base = "$($o[0]).$($o[1])"
$range = "$base.255.200-$base.255.250"
Write-Host "[istio] MetalLB pool: $range"

$pool = @"
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: kind-pool
  namespace: metallb-system
spec:
  addresses:
    - $range
---
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: kind-l2
  namespace: metallb-system
spec:
  ipAddressPools: [kind-pool]
"@
# brief retry: the metallb webhook may take a moment to accept config after rollout
$applied = $false
for ($i = 0; $i -lt 6; $i++) {
    $pool | kubectl apply -f - | Out-Host
    if ($LASTEXITCODE -eq 0) { $applied = $true; break }
    Start-Sleep -Seconds 5
}
if (-not $applied) { throw "metallb pool apply failed" }
Write-Host "[istio] done. Gateways with gatewayClassName=istio will now be programmed."
