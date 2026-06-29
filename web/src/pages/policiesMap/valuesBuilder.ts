// Pure mapping from the visual arrow model (the JSON saved per arrow) to the
// `policies` chart values. One arrow source -> target becomes an egress rule on
// the source workload (owner); the chart auto-mirrors NetworkPolicy +
// AuthorizationPolicy into the target namespace. See charts/policies/values.full.yaml.

export interface ArrowEndpoint {
  namespace: string;
  workload: string;
  serviceAccount: string | null;
  selector: Record<string, string>;
  port: number;
  protocol: string;
}

// One arrow = one record in the saved JSON. Holds everything needed to fill the
// values for this link (requirement 5).
export interface ArrowRecord {
  id: string;
  from: ArrowEndpoint;
  to: ArrowEndpoint;
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

// buildValues turns the arrow records into the `policies` chart values object
// (ready for yaml.dump). Arrows from the same source workload are merged into a
// single policy entry with multiple egress rules.
export function buildValues(arrows: ArrowRecord[]): Record<string, unknown> {
  const used = new Set<string>();
  // Key by source workload id so several arrows from one owner merge.
  const byOwner = new Map<string, ArrowRecord[]>();
  for (const a of arrows) {
    const key = `${a.from.namespace}/${a.from.workload}`;
    const list = byOwner.get(key) ?? [];
    list.push(a);
    byOwner.set(key, list);
  }

  const policies = [...byOwner.values()].map((group) => {
    const owner = group[0].from;
    return {
      name: shortName(owner.workload, used),
      enabled: true,
      namespace: owner.namespace,
      serviceAccount: owner.serviceAccount ?? undefined,
      selector: owner.selector,
      egress: group.map((a) => ({
        to: [{ namespace: a.to.namespace, selector: a.to.selector }],
        // The exposed (destination) port is what the policy allows.
        ports: [{ port: a.to.port, protocol: a.to.protocol === "UDP" ? "UDP" : "TCP" }],
      })),
    };
  });

  return {
    naming: { instanceTag: "ru1", clusterTag: "k8s1", projectTag: "nbox" },
    policies,
  };
}

// Lightweight stand-in for values.schema.json validation (requirement 7.2). The
// real flow validates against the chart schema on the backend; here we only
// sanity-check that something was drawn and names fit the 2..6 char rule.
export function validateArrows(arrows: ArrowRecord[]): string[] {
  const errors: string[] = [];
  if (arrows.length === 0) errors.push("Не нарисовано ни одной стрелки.");
  for (const a of arrows) {
    if (!a.from.serviceAccount) {
      errors.push(`Источник ${a.from.workload} без service account.`);
    }
  }
  return errors;
}
