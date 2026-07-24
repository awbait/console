// Topology model for the policies network map. The editor does not know where
// the topology came from: a TopologyProvider supplies namespace suggestions and
// ready-made workloads. The manual provider knows nothing - the user builds
// everything by hand; future tiers (orders data, console-collector snapshot,
// direct K8s API) plug in behind the same interface without editor changes.

export type WorkloadKind =
  | "Deployment"
  | "DaemonSet"
  | "StatefulSet"
  | "IngressGateway"
  | "EgressGateway";
export type PortProtocol = "HTTP" | "TCP" | "UDP" | "GRPC";

export const WORKLOAD_KINDS: WorkloadKind[] = [
  "Deployment",
  "DaemonSet",
  "StatefulSet",
  "IngressGateway",
  "EgressGateway",
];

// Display labels: the gateway kinds are shown shortened so they fit the card.
export const KIND_LABELS: Record<WorkloadKind, string> = {
  Deployment: "Deployment",
  DaemonSet: "DaemonSet",
  StatefulSet: "StatefulSet",
  IngressGateway: "Ingress GW",
  EgressGateway: "Egress GW",
};
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
// Egress gateways are the exception: they work without their own SA.
export function workloadInvalidReason(w: TopoWorkload): string | null {
  const missing: string[] = [];
  if (!w.serviceAccount && w.kind !== "EgressGateway") missing.push("нет service account");
  if (w.ports.length === 0) missing.push("нет exposed-портов");
  return missing.length ? missing.join(", ") : null;
}

// Example scenario, loadable from the toolbar: an online shop whose core
// namespace (the order) receives traffic through an ingress gateway, talks to
// its database and cache (the cache link is bidirectional) and reaches the
// outside world through an egress gateway. One workload is deliberately
// invalid (no SA) to demo the red border. Arrows come pre-drawn.
export const EXAMPLE_ORDER_NS = "shop-core";

export const EXAMPLE_TOPOLOGY: TopoNamespace[] = [
  {
    name: "shop-ingress",
    workloads: [
      {
        id: "shop-ingress/ingress-istio",
        name: "ingress-istio",
        kind: "IngressGateway",
        serviceAccount: "shop-ingress-gateway-istio",
        selector: { "app.kubernetes.io/name": "ingress-istio" },
        ports: [
          { port: 443, protocol: "HTTP" },
          { port: 15021, protocol: "TCP" },
        ],
      },
    ],
  },
  {
    name: "shop-core",
    workloads: [
      {
        id: "shop-core/backend",
        name: "backend",
        kind: "Deployment",
        serviceAccount: "backend",
        selector: { "app.kubernetes.io/name": "backend" },
        ports: [
          { port: 8080, protocol: "HTTP" },
          { port: 9100, protocol: "TCP" },
        ],
      },
      {
        id: "shop-core/legacy-app",
        name: "legacy-app",
        kind: "Deployment",
        // Invalid on purpose: no service account -> red border, blocked endpoint.
        serviceAccount: null,
        selector: { "app.kubernetes.io/name": "legacy-app" },
        ports: [{ port: 8000, protocol: "HTTP" }],
      },
    ],
  },
  {
    name: "shop-postgresql",
    workloads: [
      {
        id: "shop-postgresql/postgresql",
        name: "postgresql",
        kind: "StatefulSet",
        serviceAccount: "shop-postgresql",
        selector: { "app.kubernetes.io/name": "postgresql" },
        ports: [{ port: 5432, protocol: "TCP" }],
      },
    ],
  },
  {
    name: "shop-analytics",
    workloads: [
      {
        id: "shop-analytics/reports",
        name: "reports",
        kind: "Deployment",
        serviceAccount: "reports",
        selector: { "app.kubernetes.io/name": "reports" },
        ports: [{ port: 8081, protocol: "HTTP" }],
      },
    ],
  },
  {
    name: "shop-valkey",
    workloads: [
      {
        id: "shop-valkey/valkey-primary",
        name: "valkey-primary",
        kind: "StatefulSet",
        serviceAccount: "shop-valkey-primary",
        selector: {
          "app.kubernetes.io/name": "valkey",
          "app.kubernetes.io/component": "primary",
        },
        ports: [{ port: 6379, protocol: "TCP" }],
      },
    ],
  },
  {
    name: "shop-egress",
    workloads: [
      {
        id: "shop-egress/egress-gw",
        name: "egress-gw",
        kind: "EgressGateway",
        // Egress gateways work without their own SA (no red border).
        serviceAccount: null,
        selector: { "app.kubernetes.io/name": "egress-gw" },
        ports: [{ port: 8443, protocol: "TCP" }],
      },
    ],
  },
];

// Pre-drawn arrows of the example: in through the ingress gateway, out to the
// database, a bidirectional link with the cache and out through the egress
// gateway. Sources anchor at real port circles, like hand-drawn arrows.
export const EXAMPLE_EDGES = [
  {
    id: "ex-ingress",
    source: "shop-ingress/ingress-istio",
    target: "shop-core/backend",
    sourceHandle: "p-443-r",
    targetHandle: "p-8080-l",
    data: { bidirectional: false },
    reconnectable: true,
  },
  {
    id: "ex-db",
    source: "shop-core/backend",
    target: "shop-postgresql/postgresql",
    sourceHandle: "p-8080-r",
    targetHandle: "p-5432-l",
    data: { bidirectional: false },
    reconnectable: true,
  },
  {
    id: "ex-cache",
    source: "shop-core/backend",
    target: "shop-valkey/valkey-primary",
    sourceHandle: "p-9100-r",
    targetHandle: "p-6379-l",
    data: { bidirectional: true },
    reconnectable: true,
  },
  {
    id: "ex-egress",
    source: "shop-core/backend",
    target: "shop-egress/egress-gw",
    sourceHandle: "p-8080-r",
    targetHandle: "p-8443-l",
    data: { bidirectional: false },
    reconnectable: true,
  },
  // The analytics team reads the same database. The arrow does not touch the
  // order namespace, so it becomes a second (draft) order in shop-analytics.
  {
    id: "ex-reports",
    source: "shop-analytics/reports",
    target: "shop-postgresql/postgresql",
    sourceHandle: "p-8081-r",
    targetHandle: "p-5432-l",
    data: { bidirectional: false },
    reconnectable: true,
  },
];

export const EXAMPLE_POSITIONS: Record<string, { x: number; y: number }> = {
  "shop-ingress": { x: 0, y: 40 },
  "shop-core": { x: 330, y: 0 },
  "shop-analytics": { x: 330, y: 320 },
  "shop-postgresql": { x: 660, y: 0 },
  "shop-valkey": { x: 660, y: 200 },
  "shop-egress": { x: 660, y: 370 },
};
