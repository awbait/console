// Topology model for the policies network map. The editor does not know where
// the topology came from: a TopologyProvider supplies namespace suggestions and
// ready-made workloads. The manual provider knows nothing - the user builds
// everything by hand; future tiers (orders data, console-collector snapshot,
// direct K8s API) plug in behind the same interface without editor changes.

export type WorkloadKind = "Deployment" | "DaemonSet" | "StatefulSet";
export type PortProtocol = "HTTP" | "TCP" | "UDP" | "GRPC";

export const WORKLOAD_KINDS: WorkloadKind[] = ["Deployment", "DaemonSet", "StatefulSet"];
export const PORT_PROTOCOLS: PortProtocol[] = ["HTTP", "TCP", "UDP", "GRPC"];

export interface TopoPort {
  port: number;
  protocol: PortProtocol;
}

export interface TopoWorkload {
  id: string; // "<namespace>/<name>"
  name: string;
  kind: WorkloadKind;
  // null serviceAccount or an empty ports list makes the workload invalid:
  // it renders with a red border and cannot be an arrow endpoint.
  serviceAccount: string | null;
  // Pod selector (labels) the workload is matched by. Goes into the policy
  // selector / podSelector.
  selector: Record<string, string>;
  ports: TopoPort[];
}

export interface TopoNamespace {
  name: string;
  workloads: TopoWorkload[];
}

// TopologyProvider is the pluggable data source behind the editor. Manual mode
// returns nothing; later tiers return deployed namespaces and their workloads.
export interface TopologyProvider {
  // Known namespace names to suggest in pickers.
  suggestNamespaces(): Promise<string[]>;
  // Ready-made topology for a namespace, or null when unknown to the source.
  getNamespace(name: string): Promise<TopoNamespace | null>;
}

export const manualProvider: TopologyProvider = {
  suggestNamespaces: () => Promise.resolve([]),
  getNamespace: () => Promise.resolve(null),
};

export const workloadId = (ns: string, name: string) => `${ns}/${name}`;
export const nsOfWorkload = (id: string) => id.split("/")[0];

export function findWorkload(topology: TopoNamespace[], id: string): TopoWorkload | undefined {
  for (const ns of topology) {
    const w = ns.workloads.find((x) => x.id === id);
    if (w) return w;
  }
  return undefined;
}

// A workload may anchor an arrow only if it has a service account AND at least
// one exposed port. Returns the human-readable reason it cannot, or null.
export function workloadInvalidReason(w: TopoWorkload): string | null {
  const missing: string[] = [];
  if (!w.serviceAccount) missing.push("нет service account");
  if (w.ports.length === 0) missing.push("нет exposed-портов");
  return missing.length ? missing.join(", ") : null;
}

// Kubernetes DNS label: lower-case letters, digits and hyphens.
export const DNS_NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

// Example topology, loadable from the toolbar: demos the editor without typing
// everything in (includes deliberately invalid workloads).
export const EXAMPLE_TOPOLOGY: TopoNamespace[] = [
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
