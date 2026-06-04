# Register Argo CD repositories (as Kubernetes secrets, so no argocd CLI is
# required) and create the portal-managed AppProject.
#  - GitLab repo-creds (prefix): lets Argo clone the private values repos and
#    powers the ApplicationSet git generator.
#  - OCI repository: Harbor's Helm registry at host.docker.internal:8084 (the
#    same host name the portal uses; reachable from Argo pods via the CoreDNS
#    patch). Self-signed TLS -> insecure: "true". The platform project is public,
#    so anonymous pull works (no creds needed).
#  - gitlab-scm-token: consumed by the Step B SCM-provider generator.
param([string]$GitlabToken = "glpat-localdev0123456789abcd")
$ErrorActionPreference = "Stop"

$manifests = @"
apiVersion: v1
kind: Secret
metadata:
  name: repo-gitlab-managed-services
  namespace: argocd
  labels:
    argocd.argoproj.io/secret-type: repo-creds
stringData:
  type: git
  url: http://host.docker.internal:8929/managed-services
  username: root
  password: $GitlabToken
---
apiVersion: v1
kind: Secret
metadata:
  name: repo-oci-platform
  namespace: argocd
  labels:
    argocd.argoproj.io/secret-type: repository
stringData:
  type: helm
  name: oci-platform
  url: host.docker.internal:8084/platform
  enableOCI: "true"
  insecure: "true"          # -> helm --insecure-skip-tls-verify (Harbor uses self-signed TLS)
---
apiVersion: v1
kind: Secret
metadata:
  name: gitlab-scm-token
  namespace: argocd
stringData:
  token: $GitlabToken
"@

$manifests | kubectl apply -f - | Out-Host
if ($LASTEXITCODE -ne 0) { throw "repo secret apply failed" }

kubectl apply -f "$PSScriptRoot\appproject.yaml" | Out-Host
if ($LASTEXITCODE -ne 0) { throw "appproject apply failed" }
Write-Host "[repos] GitLab creds + OCI repo + AppProject 'portal-managed' registered."
