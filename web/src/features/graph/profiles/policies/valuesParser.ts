// Reverse mapping: a `policies` chart values object -> the graph model. Used
// by the order-form graph mode (and read-only review) to draw what the values
// already describe.
//
// The graph model is narrower than the values, so the parse cannot be total: an
// entry the canvas has no shape for is reported as an error and the caller
// refuses graph editing rather than touching the user's values. What the parse
// does not carry is not lost either - buildPolicies writes back into the entries
// these values already hold, so names and unknown keys survive the round trip.
// Rule wording is the one accepted canonicalization: a link written as ingress
// on the receiver comes back as egress on the sender, same semantics.

import type { Edge } from "@xyflow/react";
import type { XY } from "../../core/model";
import type { SavedGraphState } from "./editorState";
import {
  type PortProtocol,
  selectorFingerprint,
  type TopoNamespace,
  type TopoPort,
  type TopoWorkload,
  workloadId,
} from "./topology";
import { bodyHandleId, portHandleId } from "./WorkloadNode";

// ParsedGraph is what the values alone describe: everything the canvas holds
// beyond it comes from the saved editor state (see editorState.ts).
export interface ParsedGraph {
  topology: TopoNamespace[];
  edges: Edge[];
  positions: Record<string, XY>;
  errors: string[];
}

// Draft workload collected while walking the entries; names are finalized at
// the end (label -> entry name -> generated).
interface Draft {
  ns: string;
  selector: Record<string, string>;
  nameHint: string | null;
  serviceAccount: string | null;
  ports: Map<number, TopoPort>;
}

interface DirectedLink {
  from: Draft;
  to: Draft;
  port: number;
}

const GROUP_W = 250;
const GROUP_GAP = 80;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringMap(v: unknown): v is Record<string, string> {
  return isPlainObject(v) && Object.values(v).every((x) => typeof x === "string");
}

// Normalized chart port entry: a bare number or { port, protocol }.
function parseRulePort(v: unknown): TopoPort | null {
  if (typeof v === "number" && Number.isInteger(v)) return { port: v, protocol: "TCP" };
  if (isPlainObject(v) && typeof v.port === "number" && Number.isInteger(v.port)) {
    const proto: PortProtocol = v.protocol === "UDP" ? "UDP" : "TCP";
    return { port: v.port, protocol: proto };
  }
  return null;
}

const selectorKey = (ns: string, selector: Record<string, string>) =>
  `${ns}|${selectorFingerprint(selector)}`;

// parseValues maps values.policies back onto a graph centered on orderNs.
export function parseValues(values: Record<string, unknown>, orderNs: string): ParsedGraph {
  const errors: string[] = [];
  const drafts = new Map<string, Draft>();
  const links: DirectedLink[] = [];

  const ensure = (
    ns: string,
    selector: Record<string, string>,
    hint?: { name?: string; serviceAccount?: string },
  ): Draft => {
    const key = selectorKey(ns, selector);
    let d = drafts.get(key);
    if (!d) {
      d = {
        ns,
        selector,
        nameHint: selector["app.kubernetes.io/name"] ?? hint?.name ?? null,
        serviceAccount: hint?.serviceAccount ?? null,
        ports: new Map(),
      };
      drafts.set(key, d);
    }
    if (hint?.serviceAccount && !d.serviceAccount) d.serviceAccount = hint.serviceAccount;
    if (hint?.name && !d.nameHint) d.nameHint = hint.name;
    return d;
  };

  const raw = values.policies;
  const entries: unknown[] = Array.isArray(raw) ? raw : [];
  if (raw !== undefined && !Array.isArray(raw)) {
    errors.push("Секция policies не является списком.");
  }

  // Two entries with the same selector describe the same workload, and the graph
  // has room for only one card. Merging them silently would drop one of the two
  // on the way back to values, so such values are refused instead.
  const ownerAt = new Map<string, number>();

  entries.forEach((entryRaw, i) => {
    const at = `policies[${i}]`;
    if (!isPlainObject(entryRaw)) {
      errors.push(`${at}: запись не является объектом.`);
      return;
    }
    const entry = entryRaw;
    const label = typeof entry.name === "string" ? `${at} (${entry.name})` : at;
    if (entry.enabled === false) {
      errors.push(`${label}: enabled: false не отображается на графе.`);
      return;
    }
    if (!isStringMap(entry.selector) || Object.keys(entry.selector).length === 0) {
      errors.push(`${label}: нет selector - на графе такую запись не отобразить.`);
      return;
    }
    const fingerprint = selectorFingerprint(entry.selector);
    const twin = ownerAt.get(fingerprint);
    if (twin !== undefined) {
      errors.push(
        `${label}: тот же selector, что и у policies[${twin}] - для графа это один workload, и одна из записей потерялась бы.`,
      );
      return;
    }
    ownerAt.set(fingerprint, i);
    const owner = ensure(orderNs, entry.selector, {
      name: typeof entry.name === "string" ? entry.name : undefined,
      serviceAccount: typeof entry.serviceAccount === "string" ? entry.serviceAccount : undefined,
    });

    const walkRules = (dir: "ingress" | "egress") => {
      const rules = entry[dir];
      if (rules === undefined) return;
      if (!Array.isArray(rules)) {
        errors.push(`${label}.${dir}: не список правил.`);
        return;
      }
      rules.forEach((ruleRaw, j) => {
        const ruleAt = `${label}.${dir}[${j}]`;
        if (!isPlainObject(ruleRaw)) {
          errors.push(`${ruleAt}: правило не является объектом.`);
          return;
        }
        const ports = Array.isArray(ruleRaw.ports) ? ruleRaw.ports.map(parseRulePort) : [];
        if (ports.length === 0 || ports.some((p) => p === null)) {
          errors.push(`${ruleAt}: правило без конкретных ports не отображается на графе.`);
          return;
        }
        const peersRaw = ruleRaw[dir === "ingress" ? "from" : "to"];
        if (!Array.isArray(peersRaw) || peersRaw.length === 0) {
          errors.push(`${ruleAt}: нет ${dir === "ingress" ? "from" : "to"}.`);
          return;
        }
        for (const peerRaw of peersRaw) {
          if (!isPlainObject(peerRaw)) {
            errors.push(`${ruleAt}: peer не является объектом.`);
            continue;
          }
          if (peerRaw.ipBlock || peerRaw.namespaceSelector || peerRaw.podSelector) {
            errors.push(
              `${ruleAt}: peer с ipBlock/namespaceSelector/podSelector не отображается на графе.`,
            );
            continue;
          }
          if (typeof peerRaw.namespace !== "string" || !isStringMap(peerRaw.selector)) {
            errors.push(`${ruleAt}: peer должен иметь namespace и selector.`);
            continue;
          }
          if (peerRaw.namespace === orderNs) {
            errors.push(`${ruleAt}: peer в namespace заказа - на графе такие связи не рисуются.`);
            continue;
          }
          const peer = ensure(peerRaw.namespace, peerRaw.selector, {
            serviceAccount:
              typeof peerRaw.serviceAccount === "string" ? peerRaw.serviceAccount : undefined,
          });
          for (const p of ports as TopoPort[]) {
            if (dir === "ingress") {
              // The rule port lives on the owner; the peer is the sender.
              if (!owner.ports.has(p.port)) owner.ports.set(p.port, p);
              links.push({ from: peer, to: owner, port: p.port });
            } else {
              if (!peer.ports.has(p.port)) peer.ports.set(p.port, p);
              links.push({ from: owner, to: peer, port: p.port });
            }
          }
        }
      });
    };
    walkRules("ingress");
    walkRules("egress");
  });

  // --- finalize workloads: names, ids, topology ---------------------------

  const byNs = new Map<string, Draft[]>();
  for (const d of drafts.values()) {
    const list = byNs.get(d.ns) ?? [];
    list.push(d);
    byNs.set(d.ns, list);
  }

  const workloadOf = new Map<Draft, TopoWorkload>();
  const topology: TopoNamespace[] = [];
  const nsNames = [orderNs, ...[...byNs.keys()].filter((n) => n !== orderNs).sort()];
  for (const nsName of nsNames) {
    const list = byNs.get(nsName) ?? [];
    const usedNames = new Set<string>();
    const workloads = list.map((d, i) => {
      let name = d.nameHint ?? `workload-${i + 1}`;
      while (usedNames.has(name)) name = `${name}-2`;
      usedNames.add(name);
      const w: TopoWorkload = {
        id: workloadId(nsName, name),
        name,
        kind: "Deployment",
        serviceAccount: d.serviceAccount,
        selector: d.selector,
        ports: [...d.ports.values()].sort((a, b) => a.port - b.port),
      };
      workloadOf.set(d, w);
      return w;
    });
    topology.push({ name: nsName, workloads });
  }

  // --- edges: one arrow per unique link -------------------------------------

  // Hand-written values may repeat the same rule (and rules from different
  // source ports collapse into the same link anyway): one link per unique
  // (source, target, port) triple, so duplicates do not stack arrows. An
  // opposite pair of links (mutual ingress/egress) stays two arrows - there
  // is no bidirectional edge on the canvas.
  const seenLinks = new Set<string>();
  const uniqueLinks = links.filter((l) => {
    const key = `${selectorKey(l.from.ns, l.from.selector)}>${selectorKey(l.to.ns, l.to.selector)}:${l.port}`;
    if (seenLinks.has(key)) return false;
    seenLinks.add(key);
    return true;
  });

  const edges: Edge[] = [];
  uniqueLinks.forEach((link, i) => {
    const from = workloadOf.get(link.from);
    const to = workloadOf.get(link.to);
    if (!from || !to) return;
    edges.push({
      id: `pe-${i}`,
      source: from.id,
      target: to.id,
      // The source port does not exist in the model: anchor at the body dot.
      sourceHandle: bodyHandleId("r"),
      targetHandle: portHandleId(link.port, "l"),
      reconnectable: true,
    });
  });

  // --- layout: senders on the left, targets on the right -------------------

  const positions: Record<string, XY> = { [orderNs]: { x: 0, y: 0 } };
  let leftY = 0;
  let rightY = 0;
  for (const ns of topology) {
    if (ns.name === orderNs) continue;
    // A namespace only sending into the order namespace goes to the left.
    const sendsOnly =
      links.some((l) => l.from.ns === ns.name) && !links.some((l) => l.to.ns === ns.name);
    if (sendsOnly) {
      positions[ns.name] = { x: -(GROUP_W + GROUP_GAP), y: leftY };
      leftY += 260;
    } else {
      positions[ns.name] = { x: GROUP_W + GROUP_GAP, y: rightY };
      rightY += 260;
    }
  }

  return { topology, edges, positions, errors };
}

// mergeWithSaved overlays canvas-only state on a fresh parse: the values stay
// the source of truth for links and selectors, while the saved graph restores
// what they cannot express - workload identity/kind/SA/extra ports, unlinked
// workloads, empty namespaces and box positions.
export function mergeWithSaved(parsed: ParsedGraph, saved: SavedGraphState | null): ParsedGraph {
  if (!saved) return parsed;
  const savedBySelector = new Map<string, TopoWorkload>();
  for (const ns of saved.topology) {
    for (const w of ns.workloads) savedBySelector.set(selectorKey(ns.name, w.selector), w);
  }

  // Parsed workloads adopt the saved identity (name, kind, SA) and the union
  // of ports; edges are re-pointed when the adopted name changes the id.
  const idRemap = new Map<string, string>();
  const topology: TopoNamespace[] = parsed.topology.map((ns) => ({
    name: ns.name,
    workloads: ns.workloads.map((w) => {
      const s = savedBySelector.get(selectorKey(ns.name, w.selector));
      if (!s) return w;
      const ports = [...w.ports];
      for (const p of s.ports) {
        if (!ports.some((x) => x.port === p.port)) ports.push(p);
      }
      ports.sort((a, b) => a.port - b.port);
      const merged: TopoWorkload = {
        id: workloadId(ns.name, s.name),
        name: s.name,
        kind: s.kind,
        serviceAccount: w.serviceAccount ?? s.serviceAccount,
        selector: w.selector,
        ports,
      };
      if (merged.id !== w.id) idRemap.set(w.id, merged.id);
      return merged;
    }),
  }));

  // Bring back namespaces and workloads the values do not mention.
  for (const ns of saved.topology) {
    let target = topology.find((n) => n.name === ns.name);
    if (!target) {
      target = { name: ns.name, workloads: [] };
      topology.push(target);
    }
    for (const w of ns.workloads) {
      const key = selectorKey(ns.name, w.selector);
      const exists = target.workloads.some(
        (x) => x.name === w.name || selectorKey(ns.name, x.selector) === key,
      );
      if (!exists) target.workloads.push(w);
    }
  }

  const edges = parsed.edges.map((e) => ({
    ...e,
    source: idRemap.get(e.source) ?? e.source,
    target: idRemap.get(e.target) ?? e.target,
  }));
  // Saved positions win for boxes the user already arranged.
  const positions = { ...parsed.positions, ...saved.positions };
  return { topology, edges, positions, errors: parsed.errors };
}
