// Mock cluster topology for the policies network-map prototype. No backend:
// namespaces, their workloads, exposed ports and service accounts are hardcoded
// so the editor UX can be evaluated before the real K8s data source exists.

export type WorkloadKind = "Deployment" | "DaemonSet" | "StatefulSet";
export type PortProtocol = "HTTP" | "TCP" | "UDP" | "GRPC";

export interface MockPort {
  port: number;
  protocol: PortProtocol;
}

export interface MockWorkload {
  id: string;
  name: string;
  kind: WorkloadKind;
  // null serviceAccount or an empty ports list makes the workload invalid:
  // it renders with a red border and cannot be an arrow endpoint.
  serviceAccount: string | null;
  // Pod selector (labels) the workload is matched by. Goes into the policy
  // selector / podSelector.
  selector: Record<string, string>;
  ports: MockPort[];
}

export interface MockNamespace {
  name: string;
  workloads: MockWorkload[];
}

export const MOCK_NAMESPACES: MockNamespace[] = [
  {
    name: "netbox-ingress",
    workloads: [
      {
        id: "netbox-ingress/ingress-istio",
        name: "ingress-istio",
        kind: "Deployment",
        serviceAccount: "netbox-ingress-gateway-istio",
        selector: { "app.kubernetes.io/name": "ingress-istio" },
        ports: [
          { port: 443, protocol: "HTTP" },
          { port: 15021, protocol: "TCP" },
        ],
      },
    ],
  },
  {
    name: "netbox-core",
    workloads: [
      {
        id: "netbox-core/netbox",
        name: "netbox",
        kind: "Deployment",
        serviceAccount: "netbox",
        selector: { "app.kubernetes.io/name": "netbox" },
        ports: [
          { port: 8080, protocol: "HTTP" },
          { port: 9100, protocol: "TCP" },
        ],
      },
      {
        id: "netbox-core/netbox-worker",
        name: "netbox-worker",
        kind: "Deployment",
        // Invalid on purpose: no service account -> red border, blocked endpoint.
        serviceAccount: null,
        selector: { "app.kubernetes.io/name": "netbox-worker" },
        ports: [{ port: 8081, protocol: "HTTP" }],
      },
    ],
  },
  {
    name: "netbox-postgresql",
    workloads: [
      {
        id: "netbox-postgresql/postgresql",
        name: "postgresql",
        kind: "StatefulSet",
        serviceAccount: "netbox-postgresql",
        selector: { "app.kubernetes.io/name": "postgresql" },
        ports: [{ port: 5432, protocol: "TCP" }],
      },
    ],
  },
  {
    name: "netbox-valkey",
    workloads: [
      {
        id: "netbox-valkey/valkey-primary",
        name: "valkey-primary",
        kind: "StatefulSet",
        serviceAccount: "netbox-valkey-primary",
        selector: {
          "app.kubernetes.io/name": "valkey",
          "app.kubernetes.io/component": "primary",
        },
        ports: [{ port: 6379, protocol: "TCP" }],
      },
      {
        id: "netbox-valkey/valkey-metrics",
        name: "valkey-metrics",
        kind: "DaemonSet",
        // Invalid on purpose: no exposed ports.
        serviceAccount: "netbox-valkey-metrics",
        selector: { "app.kubernetes.io/name": "valkey-metrics" },
        ports: [],
      },
    ],
  },
];

export function findNamespace(name: string | null): MockNamespace | undefined {
  return MOCK_NAMESPACES.find((n) => n.name === name);
}

export function findWorkload(id: string): MockWorkload | undefined {
  for (const ns of MOCK_NAMESPACES) {
    const w = ns.workloads.find((x) => x.id === id);
    if (w) return w;
  }
  return undefined;
}

// A workload may anchor an arrow only if it has a service account AND at least
// one exposed port. Returns the human-readable reason it cannot, or null.
export function workloadInvalidReason(w: MockWorkload): string | null {
  const missing: string[] = [];
  if (!w.serviceAccount) missing.push("нет service account");
  if (w.ports.length === 0) missing.push("нет exposed-портов");
  return missing.length ? missing.join(", ") : null;
}
