// Pure mapping from the drawn edges straight to the `policies` chart values.
// There is no intermediate arrow JSON: the edges are the model and values.yaml
// is the only generated artifact. One edge source -> target becomes an egress
// rule on the source workload (owner); the chart auto-mirrors NetworkPolicy +
// AuthorizationPolicy into the target namespace. See charts/policies/values.full.yaml.

import type { Edge } from "@xyflow/react";
import { findWorkload, type MockPort, type MockWorkload } from "./mockData";
import { portIndexFromHandle } from "./WorkloadNode";

const nsOf = (workloadId: string) => workloadId.split("/")[0];

// A drawn edge resolved to its endpoints. Only the destination port matters for
// the generated policy (it is what the egress rule allows); the source handle
// just anchors the arrow visually.
interface ResolvedEdge {
  owner: MockWorkload;
  target: MockWorkload;
  targetPort: MockPort;
}

function resolveEdge(e: Edge): ResolvedEdge | null {
  const owner = findWorkload(e.source);
  const target = findWorkload(e.target);
  const portIndex = portIndexFromHandle(e.targetHandle);
  if (!owner || !target || portIndex === null) return null;
  const targetPort = target.ports[portIndex];
  return targetPort ? { owner, target, targetPort } : null;
}

// shortName derives a 2..6 char DNS-ish policy name from a workload name, so
// generated values look plausible. Real implementation may let the user name it.
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
// workloads/ports are silently skipped.
export function buildValues(edges: Edge[]): Record<string, unknown> {
  const used = new Set<string>();
  // Key by source workload id so several edges from one owner merge.
  const byOwner = new Map<string, ResolvedEdge[]>();
  for (const e of edges) {
    const link = resolveEdge(e);
    if (!link) continue;
    const list = byOwner.get(link.owner.id) ?? [];
    list.push(link);
    byOwner.set(link.owner.id, list);
  }

  const policies = [...byOwner.values()].map((links) => {
    const owner = links[0].owner;
    return {
      name: shortName(owner.name, used),
      enabled: true,
      namespace: nsOf(owner.id),
      serviceAccount: owner.serviceAccount ?? undefined,
      selector: owner.selector,
      egress: links.map((l) => ({
        to: [{ namespace: nsOf(l.target.id), selector: l.target.selector }],
        // The exposed (destination) port is what the policy allows.
        ports: [
          { port: l.targetPort.port, protocol: l.targetPort.protocol === "UDP" ? "UDP" : "TCP" },
        ],
      })),
    };
  });

  return {
    naming: { instanceTag: "ru1", clusterTag: "k8s1", projectTag: "nbox" },
    policies,
  };
}

// Lightweight stand-in for values.schema.json validation. The real flow
// validates against the chart schema on the backend; here we only sanity-check
// that something was drawn and the owners can carry a policy.
export function validateEdges(edges: Edge[]): string[] {
  const errors: string[] = [];
  if (edges.length === 0) errors.push("Не нарисовано ни одной стрелки.");
  for (const e of edges) {
    const link = resolveEdge(e);
    if (link && !link.owner.serviceAccount) {
      errors.push(`Источник ${link.owner.name} без service account.`);
    }
  }
  return errors;
}
