// Pure mapping from the drawn edges straight to the `policies` chart values.
// There is no intermediate arrow JSON: the edges are the model and values.yaml
// is the only generated artifact.
//
// Generation is centered on the ORDER namespace (the release namespace of the
// policies chart): every policies[] entry describes an owner workload living
// there. An arrow leaving the order namespace becomes an egress rule on its
// source owner; an arrow entering it becomes an ingress rule on its target
// owner (the chart mirrors the sender-side egress NetworkPolicy itself). An
// arrow not touching the order namespace cannot be expressed in this release
// and is reported out of scope.

import type { Edge } from "@xyflow/react";
import { dnsLabelError, fieldMsg, withField } from "../../form/fieldErrors";
import {
  findWorkload,
  nsOfWorkload,
  type TopoNamespace,
  type TopoPort,
  type TopoWorkload,
} from "./topology";
import { portFromHandle } from "./WorkloadNode";

// Naming tags required by the chart (resource name convention
// {instanceTag}-{clusterTag}-{kindShort}-{projectTag}-{name}).
export interface NamingTags {
  instanceTag: string;
  clusterTag: string;
  projectTag: string;
}

export const DEFAULT_NAMING: NamingTags = {
  instanceTag: "ru1",
  clusterTag: "k8s1",
  projectTag: "prj",
};

// A directed link relative to the order namespace: the owner is always the
// endpoint inside it, the peer is the other side, port is the destination
// port the rule allows.
interface DirectedLink {
  dir: "ingress" | "egress";
  owner: TopoWorkload;
  peer: TopoWorkload;
  port: TopoPort;
}

// edgeLinks maps an edge to its directed link. outOfScope carries a
// human-readable description when the edge does not touch the order
// namespace at all.
function edgeLinks(
  topology: TopoNamespace[],
  orderNs: string,
  e: Edge,
): { links: DirectedLink[]; outOfScope: string | null } {
  const src = findWorkload(topology, e.source);
  const dst = findWorkload(topology, e.target);
  const tp = portFromHandle(e.targetHandle);
  if (!src || !dst || tp === null) return { links: [], outOfScope: null };
  const srcNs = nsOfWorkload(src.id);
  const dstNs = nsOfWorkload(dst.id);
  if (srcNs !== orderNs && dstNs !== orderNs) {
    return { links: [], outOfScope: `${src.name} (${srcNs}) -> ${dst.name} (${dstNs})` };
  }
  const links: DirectedLink[] = [];
  const dstPort = dst.ports.find((p) => p.port === tp);
  if (dstPort) {
    if (srcNs === orderNs) links.push({ dir: "egress", owner: src, peer: dst, port: dstPort });
    else links.push({ dir: "ingress", owner: dst, peer: src, port: dstPort });
  }
  return { links, outOfScope: null };
}

// shortName derives a 2..6 char DNS-ish policy name from a workload name, so
// generated values look plausible. Later the user may name policies explicitly.
function shortName(workload: string, used: Set<string>): string {
  const base = workload.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 5) || "pol";
  let name = base;
  let i = 1;
  while (used.has(name)) {
    name = `${base.slice(0, 4)}${i}`;
    i++;
  }
  used.add(name);
  return name;
}

const rulePort = (p: TopoPort) => ({
  port: p.port,
  protocol: p.protocol === "UDP" ? "UDP" : "TCP",
});

// buildPolicies turns the drawn edges into the policies[] section. Links of
// the same owner merge into one entry; edges out of the order namespace scope
// are skipped (validateSubmit reports them).
export function buildPolicies(
  topology: TopoNamespace[],
  edges: Edge[],
  orderNs: string | null,
): unknown[] {
  const used = new Set<string>();
  const byOwner = new Map<
    string,
    { owner: TopoWorkload; ingress: unknown[]; egress: unknown[] }
  >();
  if (orderNs) {
    for (const e of edges) {
      for (const link of edgeLinks(topology, orderNs, e).links) {
        const g = byOwner.get(link.owner.id) ?? { owner: link.owner, ingress: [], egress: [] };
        if (link.dir === "egress") {
          g.egress.push({
            to: [{ namespace: nsOfWorkload(link.peer.id), selector: link.peer.selector }],
            ports: [rulePort(link.port)],
          });
        } else {
          const from: Record<string, unknown> = {
            namespace: nsOfWorkload(link.peer.id),
            selector: link.peer.selector,
          };
          // Sender SA feeds the AuthorizationPolicy principal when known.
          if (link.peer.serviceAccount) from.serviceAccount = link.peer.serviceAccount;
          g.ingress.push({ from: [from], ports: [rulePort(link.port)] });
        }
        byOwner.set(link.owner.id, g);
      }
    }
  }

  return [...byOwner.values()].map((g) => ({
    name: shortName(g.owner.name, used),
    enabled: true,
    serviceAccount: g.owner.serviceAccount ?? undefined,
    selector: g.owner.selector,
    ...(g.ingress.length > 0 ? { ingress: g.ingress } : {}),
    ...(g.egress.length > 0 ? { egress: g.egress } : {}),
  }));
}

// buildValues wraps buildPolicies into a full sandbox values object.
export function buildValues(
  topology: TopoNamespace[],
  edges: Edge[],
  naming: NamingTags,
  orderNs: string | null,
): Record<string, unknown> {
  return { naming, policies: buildPolicies(topology, edges, orderNs) };
}

export interface EdgeGroup {
  ns: string;
  edges: Edge[];
}

// partitionEdges splits the drawn edges into per-order groups: the chosen
// order namespace absorbs every edge touching it; each remaining edge goes to
// the group of its source namespace (it becomes an egress rule there). One
// group = one policies order; empty groups are dropped, the primary one comes
// first.
export function partitionEdges(
  topology: TopoNamespace[],
  edges: Edge[],
  orderNs: string | null,
): EdgeGroup[] {
  const primary: Edge[] = [];
  const rest = new Map<string, Edge[]>();
  for (const e of edges) {
    if (!findWorkload(topology, e.source) || !findWorkload(topology, e.target)) continue;
    const srcNs = nsOfWorkload(e.source);
    const dstNs = nsOfWorkload(e.target);
    if (orderNs && (srcNs === orderNs || dstNs === orderNs)) {
      primary.push(e);
    } else {
      const list = rest.get(srcNs) ?? [];
      list.push(e);
      rest.set(srcNs, list);
    }
  }
  const groups: EdgeGroup[] = [];
  if (orderNs && primary.length > 0) groups.push({ ns: orderNs, edges: primary });
  for (const [ns, list] of [...rest.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    groups.push({ ns, edges: list });
  }
  return groups;
}

// Lightweight stand-in for values.schema.json validation. The real flow
// validates against the chart schema on the backend; here we only sanity-check
// that something was drawn and required fields hold together.
export function validateSubmit(
  topology: TopoNamespace[],
  edges: Edge[],
  naming: NamingTags,
  orderNs: string | null,
): string[] {
  const errors: string[] = [];
  if (!orderNs) {
    errors.push("Не выбран namespace заказа (ПКМ по кубику namespace).");
    return errors;
  }
  if (edges.length === 0) errors.push("Не нарисовано ни одной стрелки.");
  // Edges not touching the order namespace become extra per-namespace orders
  // (drafts), so they are validated against their own group namespace.
  for (const group of partitionEdges(topology, edges, orderNs)) {
    for (const e of group.edges) {
      for (const link of edgeLinks(topology, group.ns, e).links) {
        // Egress gateways may own policies without their own service account.
        if (
          link.dir === "egress" &&
          !link.owner.serviceAccount &&
          link.owner.kind !== "EgressGateway"
        ) {
          errors.push(`Источник ${link.owner.name} без service account.`);
        }
      }
    }
  }
  for (const [label, v] of [
    ["instanceTag", naming.instanceTag],
    ["clusterTag", naming.clusterTag],
  ] as const) {
    const e = v ? dnsLabelError(v) : fieldMsg.required;
    if (e) errors.push(withField(label, e));
  }
  const pt = naming.projectTag;
  const ptErr = !pt
    ? fieldMsg.required
    : pt.length < 2
      ? fieldMsg.minLen(2)
      : dnsLabelError(pt, 6);
  if (ptErr) errors.push(withField("projectTag", ptErr));
  return errors;
}
