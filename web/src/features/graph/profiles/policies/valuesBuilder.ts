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
import { dnsLabelError, fieldMsg, withField } from "../../../../form/fieldErrors";
import {
  findWorkload,
  nsOfWorkload,
  selectorFingerprint,
  type TopoNamespace,
  type TopoPort,
  type TopoWorkload,
} from "./topology";
import { portFromHandle } from "./WorkloadNode";

// Identity tags required by the chart (resource name convention
// {instance}-{cluster}-{kindShort}-{project}-{name}). instance/cluster come
// from the environment list (see environments.ts), project is user input.
export interface IdentityTags {
  instance: string;
  cluster: string;
  project: string;
}

export const EMPTY_IDENTITY: IdentityTags = {
  instance: "",
  cluster: "",
  project: "",
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

// shortName derives a 2..6 char DNS-ish policy name from a workload name. Used
// only for an entry the values do not have yet: an existing entry keeps the name
// it was written with, whoever wrote it.
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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// previousEntries indexes the policies[] the values already hold by the workload
// they describe, so regeneration can write into the existing entry instead of a
// fresh one. Entries the graph could not have produced (no object, no selector)
// are ignored here - parseValues refuses such values outright.
function previousEntries(prev: unknown): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(prev)) return out;
  for (const raw of prev) {
    if (!isPlainObject(raw)) continue;
    const selector = raw.selector;
    if (!isPlainObject(selector)) continue;
    if (!Object.values(selector).every((v) => typeof v === "string")) continue;
    const key = selectorFingerprint(selector as Record<string, string>);
    if (!out.has(key)) out.set(key, raw);
  }
  return out;
}

// rewrite merges what was drawn into the entry the values already had. The graph
// is the source of truth for exactly four keys - selector, serviceAccount,
// ingress, egress - so one it no longer produces is dropped (arrows deleted, the
// service account removed) and everything else survives as written, in the order
// it was written: entries edited on the canvas should still read as their author
// left them.
function rewrite(
  before: Record<string, unknown>,
  owner: TopoWorkload,
  ingress: unknown[],
  egress: unknown[],
): Record<string, unknown> {
  const entry = { ...before };
  entry.selector = owner.selector;
  if (owner.serviceAccount) entry.serviceAccount = owner.serviceAccount;
  else delete entry.serviceAccount;
  if (ingress.length > 0) entry.ingress = ingress;
  else delete entry.ingress;
  if (egress.length > 0) entry.egress = egress;
  else delete entry.egress;
  return entry;
}

// buildPolicies turns the drawn edges into the policies[] section. Links of
// the same owner merge into one entry; edges out of the order namespace scope
// are skipped (validateSubmit reports them).
//
// prev is the policies[] these values already carry for THIS namespace. Passing
// it keeps the entries the user (or a newer chart) wrote: their names and any
// key the graph knows nothing about survive editing, so drawing an arrow never
// silently drops a field. Omit it only when generating into empty values.
export function buildPolicies(
  topology: TopoNamespace[],
  edges: Edge[],
  orderNs: string | null,
  prev?: unknown,
): unknown[] {
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

  // Names already in the values are reserved before anything is generated, so a
  // new entry cannot take the name of one that is being kept.
  const groups = [...byOwner.values()];
  const kept = previousEntries(prev);
  const keptFor = new Map<string, Record<string, unknown>>();
  const used = new Set<string>();
  for (const g of groups) {
    const before = kept.get(selectorFingerprint(g.owner.selector));
    if (!before) continue;
    keptFor.set(g.owner.id, before);
    if (typeof before.name === "string" && before.name) used.add(before.name);
  }

  return groups.map((g) => {
    const before = keptFor.get(g.owner.id);
    if (before) return rewrite(before, g.owner, g.ingress, g.egress);
    return {
      name: shortName(g.owner.name, used),
      enabled: true,
      serviceAccount: g.owner.serviceAccount ?? undefined,
      selector: g.owner.selector,
      ...(g.ingress.length > 0 ? { ingress: g.ingress } : {}),
      ...(g.egress.length > 0 ? { egress: g.egress } : {}),
    };
  });
}

// buildValues wraps buildPolicies into a full values object for the order. prev
// is the policies[] of the values this namespace was generated from, if any.
export function buildValues(
  topology: TopoNamespace[],
  edges: Edge[],
  identity: IdentityTags,
  orderNs: string | null,
  prev?: unknown,
): Record<string, unknown> {
  return { identity, policies: buildPolicies(topology, edges, orderNs, prev) };
}

export interface EdgeGroup {
  ns: string;
  edges: Edge[];
}

// partitionEdges splits the drawn edges into per-order groups. The chosen
// order namespace absorbs every edge touching it. The remaining edges are
// covered by as FEW extra drafts as possible: an order in namespace X can
// express any edge touching X (incoming as ingress, outgoing as egress), so
// namespaces are tried by decreasing relation count and one becomes a draft
// only while it still has an uncovered relation - a namespace whose every
// relation already touches the order or an earlier draft stays as is. Each
// edge belongs to the first group that covered it; empty groups are dropped,
// the primary one comes first.
export function partitionEdges(
  topology: TopoNamespace[],
  edges: Edge[],
  orderNs: string | null,
): EdgeGroup[] {
  const primary: Edge[] = [];
  const rest: Edge[] = [];
  for (const e of edges) {
    if (!findWorkload(topology, e.source) || !findWorkload(topology, e.target)) continue;
    const srcNs = nsOfWorkload(e.source);
    const dstNs = nsOfWorkload(e.target);
    if (orderNs && (srcNs === orderNs || dstNs === orderNs)) primary.push(e);
    else rest.push(e);
  }
  const groups: EdgeGroup[] = [];
  if (orderNs && primary.length > 0) groups.push({ ns: orderNs, edges: primary });

  // Relation count per namespace over ALL drawn edges (not only the ones
  // that still need covering): a namespace that is already a hub - say a
  // shared database also talked to by the order - should own the draft.
  // Ties break alphabetically so the result is stable.
  const degree = new Map<string, number>();
  for (const e of [...primary, ...rest]) {
    for (const ns of [nsOfWorkload(e.source), nsOfWorkload(e.target)]) {
      if (ns !== orderNs) degree.set(ns, (degree.get(ns) ?? 0) + 1);
    }
  }
  const candidates = [...degree.keys()].sort(
    (a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b),
  );
  const covered = new Set<Edge>();
  for (const ns of candidates) {
    const mine = rest.filter(
      (e) => !covered.has(e) && (nsOfWorkload(e.source) === ns || nsOfWorkload(e.target) === ns),
    );
    if (mine.length === 0) continue;
    for (const e of mine) covered.add(e);
    groups.push({ ns, edges: mine });
  }
  return groups;
}

// Lightweight stand-in for values.schema.json validation. The real flow
// validates against the chart schema on the backend; here we only sanity-check
// that something was drawn and required fields hold together.
export function validateSubmit(
  topology: TopoNamespace[],
  edges: Edge[],
  identity: IdentityTags,
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
    ["Инстанс", identity.instance],
    ["Кластер", identity.cluster],
  ] as const) {
    const e = v ? dnsLabelError(v) : fieldMsg.required;
    if (e) errors.push(withField(label, e));
  }
  const pt = identity.project;
  const ptErr = !pt
    ? fieldMsg.required
    : pt.length < 2
      ? fieldMsg.minLen(2)
      : dnsLabelError(pt, 6);
  if (ptErr) errors.push(withField("Проект", ptErr));
  return errors;
}
