# Tear down the KinD e2e stand.
$ErrorActionPreference = "Stop"
kind delete cluster --name idp
Write-Host "[down] kind cluster 'idp' deleted. (GitLab/portal stack: 'docker compose ... down' separately.)"
