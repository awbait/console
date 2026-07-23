// Reverse mapping: a `policies` chart values object -> the graph model. Used
// by the order-form graph mode (and read-only review) to draw what the values
// already describe. The mapping is lossy by design: entry names are
// regenerated on the way back (accepted canonicalization) and anything the
// graph cannot represent is reported as an error so the caller can refuse
// graph editing without touching the user's values.

import type { Edge } from "@xyflow/react";
import type { XY } from "./PoliciesGraph";
import {
  type PortProtocol,
  type TopoNamespace,
  type TopoPort,
  type TopoWorkload,
  workloadId,
} from "./topology";
import { bodyHandleId, portHandleId } from "./WorkloadNode";

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
  `${ns}|${Object.keys(selector)
    .sort()
    .map((k) => `${k}=${selector[k]}`)
    .join(",")}`;

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

  // --- edges: merge opposite link pairs into bidirectional ones ------------

  const edges: Edge[] = [];
  const consumed = new Set<number>();
  links.forEach((link, i) => {
    if (consumed.has(i)) return;
    const from = workloadOf.get(link.from);
    const to = workloadOf.get(link.to);
    if (!from || !to) return;
    // A reverse link between the same pair merges into one two-way edge; its
    // port becomes the source-side anchor (the reverse destination port).
    const backIdx = links.findIndex(
      (b, j) => j > i && !consumed.has(j) && b.from === link.to && b.to === link.from,
    );
    if (backIdx >= 0) {
      consumed.add(backIdx);
      edges.push({
        id: `pe-${i}`,
        source: from.id,
        target: to.id,
        sourceHandle: portHandleId(links[backIdx].port, "r"),
        targetHandle: portHandleId(link.port, "l"),
        data: { bidirectional: true },
        reconnectable: true,
      });
      return;
    }
    edges.push({
      id: `pe-${i}`,
      source: from.id,
      target: to.id,
      // The source port is not recorded in values: anchor at the body handle.
      sourceHandle: bodyHandleId("r"),
      targetHandle: portHandleId(link.port, "l"),
      data: { bidirectional: false },
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
