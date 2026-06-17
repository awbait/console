# Install Argo CD, run argocd-server in insecure (HTTP) mode, expose it on
# NodePort 30083 (-> hostPort 8083), and give the admin account apiKey capability
# so a long-lived ARGOCD_TOKEN can be minted (see token.ps1).
#
# JSON patches are passed via --patch-file (temp files) rather than inline -p,
# because Windows PowerShell mangles double quotes when forwarding args to exes.
$ErrorActionPreference = "Stop"

function Patch-File([string]$json) {
    $f = New-TemporaryFile
    $json | Set-Content -Path $f -Encoding utf8
    return $f
}

kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f - | Out-Host
# Pinned for reproducibility (the `stable` branch is a moving target). Bump
# deliberately and re-test; keep in sync with the version the stand was verified on.
$argoVersion = "v3.4.3"
Write-Host "[argocd] installing manifests ($argoVersion)..."
# Server-side apply: the applicationsets CRD is too large for client-side apply
# (the last-applied annotation exceeds the 256 KB metadata limit).
kubectl apply -n argocd --server-side --force-conflicts -f "https://raw.githubusercontent.com/argoproj/argo-cd/$argoVersion/manifests/install.yaml" | Out-Host
if ($LASTEXITCODE -ne 0) { throw "argocd install failed" }

# Serve plain HTTP (the Go client connects over http://host.docker.internal:8083).
$p1 = Patch-File '{"data":{"server.insecure":"true"}}'
kubectl -n argocd patch configmap argocd-cmd-params-cm --type merge --patch-file $p1 | Out-Host
# Allow minting API tokens for the admin account, and tighten the app
# reconciliation interval (default 180s) to 30s so git changes (deploy/delete)
# reflect in the stand within ~30s instead of up to 3 min.
$p2 = Patch-File '{"data":{"accounts.admin":"apiKey,login","timeout.reconciliation":"30s"}}'
kubectl -n argocd patch configmap argocd-cm --type merge --patch-file $p2 | Out-Host
# Expose argocd-server via a fixed NodePort matching kind-config extraPortMappings.
$p3 = Patch-File '{"spec":{"type":"NodePort","ports":[{"name":"http","port":80,"targetPort":8080,"nodePort":30083},{"name":"https","port":443,"targetPort":8080,"nodePort":30443}]}}'
kubectl -n argocd patch svc argocd-server --type merge --patch-file $p3 | Out-Host

Remove-Item $p1, $p2, $p3 -ErrorAction SilentlyContinue

kubectl -n argocd rollout restart deployment argocd-server | Out-Host
# The application-controller caches timeout.reconciliation at startup, so restart
# it too for the 30s interval above to take effect.
kubectl -n argocd rollout restart statefulset argocd-application-controller | Out-Host
Write-Host "[argocd] waiting for argocd-server + repo-server + applicationset-controller..."
kubectl -n argocd rollout status deployment argocd-server --timeout=240s | Out-Host
kubectl -n argocd rollout status deployment argocd-repo-server --timeout=240s | Out-Host
kubectl -n argocd rollout status deployment argocd-applicationset-controller --timeout=240s | Out-Host
kubectl -n argocd rollout status statefulset argocd-application-controller --timeout=240s | Out-Host
Write-Host "[argocd] ready on http://host.docker.internal:8083"
