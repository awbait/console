// Pure mapping from the drawn edges straight to the `policies` chart values.
// There is no intermediate arrow JSON: the edges are the model and values.yaml
// is the only generated artifact. One edge source -> target becomes an egress
// rule on the source workload (owner); the chart auto-mirrors NetworkPolicy +
// AuthorizationPolicy into the target namespace. See charts/policies/values.full.yaml.

import type { Edge } from "@xyflow/react";
import {
  DNS_NAME_RE,
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

// A drawn edge resolved to directed links. A one-way edge allows access to the
// target port; a bidirectional edge (data.bidirectional) is two links at once,
// the reverse one allowing access to the source-side port.
interface ResolvedLink {
  owner: TopoWorkload;
  target: TopoWorkload;
  targetPort: TopoPort;
}

function resolveEdge(topology: TopoNamespace[], e: Edge): ResolvedLink[] {
  const src = findWorkload(topology, e.source);
  const dst = findWorkload(topology, e.target);
  const sp = portFromHandle(e.sourceHandle);
  const tp = portFromHandle(e.targetHandle);
  if (!src || !dst || sp === null || tp === null) return [];
  const links: ResolvedLink[] = [];
  const targetPort = dst.ports.find((p) => p.port === tp);
  if (targetPort) links.push({ owner: src, target: dst, targetPort });
  if (e.data?.bidirectional === true) {
    const sourcePort = src.ports.find((p) => p.port === sp);
    if (sourcePort) links.push({ owner: dst, target: src, targetPort: sourcePort });
  }
  return links;
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

// buildValues turns the drawn edges into the `policies` chart values object
// (ready for yaml.dump). Edges from the same source workload are merged into a
// single policy entry with multiple egress rules. Edges pointing at removed
// workloads/ports are silently skipped (the editor prunes them anyway).
export function buildValues(
  topology: TopoNamespace[],
  edges: Edge[],
  naming: NamingTags,
): Record<string, unknown> {
  const used = new Set<string>();
  // Key by owner workload id so several links from one owner merge.
  const byOwner = new Map<string, ResolvedLink[]>();
  for (const e of edges) {
    for (const link of resolveEdge(topology, e)) {
      const list = byOwner.get(link.owner.id) ?? [];
      list.push(link);
      byOwner.set(link.owner.id, list);
    }
  }

  const policies = [...byOwner.values()].map((links) => {
    const owner = links[0].owner;
    return {
      name: shortName(owner.name, used),
      enabled: true,
      namespace: nsOfWorkload(owner.id),
      serviceAccount: owner.serviceAccount ?? undefined,
      selector: owner.selector,
      egress: links.map((l) => ({
        to: [{ namespace: nsOfWorkload(l.target.id), selector: l.target.selector }],
        // The exposed (destination) port is what the policy allows.
        ports: [
          { port: l.targetPort.port, protocol: l.targetPort.protocol === "UDP" ? "UDP" : "TCP" },
        ],
      })),
    };
  });

  return { naming, policies };
}

// Lightweight stand-in for values.schema.json validation. The real flow
// validates against the chart schema on the backend; here we only sanity-check
// that something was drawn and required fields hold together.
export function validateSubmit(
  topology: TopoNamespace[],
  edges: Edge[],
  naming: NamingTags,
): string[] {
  const errors: string[] = [];
  if (edges.length === 0) errors.push("Не нарисовано ни одной стрелки.");
  for (const e of edges) {
    for (const link of resolveEdge(topology, e)) {
      if (!link.owner.serviceAccount) {
        errors.push(`Источник ${link.owner.name} без service account.`);
      }
    }
  }
  if (!DNS_NAME_RE.test(naming.instanceTag)) errors.push("naming: instanceTag не в DNS-формате.");
  if (!DNS_NAME_RE.test(naming.clusterTag)) errors.push("naming: clusterTag не в DNS-формате.");
  if (!DNS_NAME_RE.test(naming.projectTag) || naming.projectTag.length < 2 || naming.projectTag.length > 6) {
    errors.push("naming: projectTag - 2..6 символов в DNS-формате.");
  }
  return errors;
}
