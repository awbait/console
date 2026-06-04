# Make `host.docker.internal` resolvable from inside KinD pods so Argo's
# repo-server can clone GitLab at the same URL the portal and host browser use.
# Docker Desktop does NOT inject that alias into the KinD node/CoreDNS, so we add
# a CoreDNS `hosts` entry pointing it at the `kind` docker-network IPv4 gateway
# (which routes to the host's published ports).
#
# We rewrite the whole Corefile (a known-good kind default + the hosts block)
# rather than string-patching the live one: it is self-healing and avoids the
# array/newline pitfalls of editing captured multi-line config.
$ErrorActionPreference = "Stop"

# The kind network has both an IPv6 and an IPv4 subnet; pick the IPv4 gateway.
$gw = (docker network inspect kind --format '{{range .IPAM.Config}}{{println .Gateway}}{{end}}' |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -match '^\d{1,3}(\.\d{1,3}){3}$' } |
    Select-Object -First 1)
if (-not $gw) { throw "could not determine IPv4 'kind' network gateway" }
Write-Host "[coredns] kind network IPv4 gateway = $gw"

$corefile = @"
.:53 {
    errors
    health {
       lameduck 5s
    }
    ready
    hosts {
       $gw host.docker.internal
       fallthrough
    }
    kubernetes cluster.local in-addr.arpa ip6.arpa {
       pods insecure
       fallthrough in-addr.arpa ip6.arpa
       ttl 30
    }
    prometheus :9153
    forward . /etc/resolv.conf {
       max_concurrent 1000
    }
    cache 30 {
       disable success cluster.local
       disable denial cluster.local
    }
    loop
    reload
    loadbalance
}
"@

$patchJson = @{ data = @{ Corefile = $corefile } } | ConvertTo-Json -Depth 10
$pf = New-TemporaryFile
$patchJson | Set-Content -Path $pf -Encoding utf8
kubectl -n kube-system patch configmap coredns --type merge --patch-file $pf | Out-Host
if ($LASTEXITCODE -ne 0) { throw "coredns patch failed" }
Remove-Item $pf -ErrorAction SilentlyContinue

kubectl -n kube-system rollout restart deployment coredns | Out-Host
kubectl -n kube-system rollout status deployment coredns --timeout=180s | Out-Host
Write-Host "[coredns] done. (verify: kubectl run dnstest --rm -it --image=busybox --restart=Never -- nslookup host.docker.internal)"
