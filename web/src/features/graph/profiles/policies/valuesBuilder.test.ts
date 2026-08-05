import { describe, expect, test } from "bun:test";
import type { Edge } from "@xyflow/react";
import { type TopoNamespace, type TopoWorkload, workloadId } from "./topology";
import { buildPolicies, partitionEdges } from "./valuesBuilder";
import { parseValues } from "./valuesParser";
import { bodyHandleId, portHandleId } from "./WorkloadNode";

function wl(ns: string, name: string, port: number): TopoWorkload {
  return {
    id: workloadId(ns, name),
    name,
    kind: "Deployment",
    serviceAccount: `${name}-sa`,
    selector: { "app.kubernetes.io/name": name },
    ports: [{ port, protocol: "TCP" }],
  };
}

// One workload per namespace keeps the arrows easy to spell.
const topology: TopoNamespace[] = ["ord", "a", "b", "c", "d"].map((ns, i) => ({
  name: ns,
  workloads: [wl(ns, "w", 1000 + i)],
}));

function arrow(id: string, sourceNs: string, targetNs: string): Edge {
  const port = 1000 + ["ord", "a", "b", "c", "d"].indexOf(targetNs);
  return {
    id,
    source: workloadId(sourceNs, "w"),
    target: workloadId(targetNs, "w"),
    sourceHandle: bodyHandleId("r"),
    targetHandle: portHandleId(port, "l"),
  };
}

describe("partitionEdges", () => {
  test("edges touching the order namespace form the primary group", () => {
    const groups = partitionEdges(topology, [arrow("e1", "ord", "a"), arrow("e2", "b", "ord")], "ord");
    expect(groups).toHaveLength(1);
    expect(groups[0].ns).toBe("ord");
    expect(groups[0].edges).toHaveLength(2);
  });

  test("a hub namespace absorbs its neighbours' edges into one draft", () => {
    // a, c, d all talk to b: one draft in b (three ingress rules), not three.
    const edges = [
      arrow("e1", "ord", "a"),
      arrow("e2", "a", "b"),
      arrow("e3", "c", "b"),
      arrow("e4", "d", "b"),
    ];
    const groups = partitionEdges(topology, edges, "ord");
    expect(groups.map((g) => g.ns)).toEqual(["ord", "b"]);
    expect(groups[1].edges.map((e) => e.id).sort()).toEqual(["e2", "e3", "e4"]);
  });

  test("a namespace whose relations are already covered stays as is", () => {
    // Chain a -> b -> c: b covers both edges, a and c need no draft.
    const edges = [arrow("e1", "a", "b"), arrow("e2", "b", "c")];
    const groups = partitionEdges(topology, edges, "ord");
    expect(groups.map((g) => g.ns)).toEqual(["b"]);
    expect(groups[0].edges).toHaveLength(2);
  });

  test("relations with the order count too: the busier namespace owns the draft", () => {
    // Like the built-in example: the order talks to b (a shared database) and
    // a also reads it. b has two relations in total vs one of a, so the draft
    // lands in b even though only one edge needs covering.
    const edges = [arrow("e1", "ord", "b"), arrow("e2", "a", "b")];
    const groups = partitionEdges(topology, edges, "ord");
    expect(groups.map((g) => g.ns)).toEqual(["ord", "b"]);
    expect(groups[1].edges.map((e) => e.id)).toEqual(["e2"]);
  });

  test("an edge is claimed by the first covering draft only", () => {
    // b (3 relations) becomes a draft first and claims a -> b; a second draft
    // appears only for the edge b cannot cover (c -> d), without duplicates.
    const edges = [
      arrow("e1", "a", "b"),
      arrow("e2", "b", "c"),
      arrow("e3", "d", "b"),
      arrow("e4", "c", "d"),
    ];
    const groups = partitionEdges(topology, edges, "ord");
    expect(groups.map((g) => g.ns)).toEqual(["b", "c"]);
    expect(groups[0].edges.map((e) => e.id).sort()).toEqual(["e1", "e2", "e3"]);
    expect(groups[1].edges.map((e) => e.id)).toEqual(["e4"]);
  });
});

// The graph owns the selector, the service account and the rule lists of an
// entry. Everything else in it belongs to whoever wrote it, and drawing on the
// canvas must not quietly throw it away.
describe("buildPolicies keeps what it does not own", () => {
  type Entry = Record<string, unknown>;

  function link(id: string, source: string, target: string, port: number): Edge {
    return {
      id,
      source,
      target,
      sourceHandle: bodyHandleId("r"),
      targetHandle: portHandleId(port, "l"),
    };
  }

  const shop: TopoNamespace[] = [
    { name: "ord", workloads: [wl("ord", "backend", 8080)] },
    { name: "db", workloads: [wl("db", "pg", 5432)] },
  ];
  const toDb = [link("e1", "ord/backend", "db/pg", 5432)];
  const fromDb = [link("e2", "db/pg", "ord/backend", 8080)];

  const previous: Entry[] = [
    {
      name: "my-policy",
      enabled: true,
      priority: 10,
      annotations: { owner: "team-core" },
      serviceAccount: "backend-sa",
      selector: { "app.kubernetes.io/name": "backend" },
      egress: [
        {
          to: [{ namespace: "db", selector: { "app.kubernetes.io/name": "pg" } }],
          ports: [{ port: 5432, protocol: "TCP" }],
        },
      ],
    },
  ];

  test("an unknown key and the entry name survive regeneration", () => {
    const [entry] = buildPolicies(shop, toDb, "ord", previous) as Entry[];
    expect(entry.name).toBe("my-policy");
    expect(entry.priority).toBe(10);
    expect(entry.annotations).toEqual({ owner: "team-core" });
  });

  test("without the previous values the name is generated as before", () => {
    const [entry] = buildPolicies(shop, toDb, "ord") as Entry[];
    expect(entry.name).toBe("backe");
    expect(entry.priority).toBeUndefined();
  });

  test("an owned key the graph no longer produces is dropped", () => {
    // The arrow now points the other way: the entry keeps its unknown key but
    // its egress rule must go, otherwise deleted traffic would stay allowed.
    const [entry] = buildPolicies(shop, fromDb, "ord", previous) as Entry[];
    expect(entry.ingress).toBeDefined();
    expect("egress" in entry).toBe(false);
    expect(entry.priority).toBe(10);
  });

  test("removing the service account on the canvas removes it from the entry", () => {
    const noSa = shop.map((ns) =>
      ns.name === "ord"
        ? { name: ns.name, workloads: [{ ...ns.workloads[0], serviceAccount: null }] }
        : ns,
    );
    const [entry] = buildPolicies(noSa, toDb, "ord", previous) as Entry[];
    expect("serviceAccount" in entry).toBe(false);
    expect(entry.priority).toBe(10);
  });

  test("a generated name cannot take the name of a kept entry", () => {
    // Both workloads shorten to "backe"; the kept entry owns it, so the new one
    // has to move aside instead of colliding.
    const two: TopoNamespace[] = [
      { name: "ord", workloads: [wl("ord", "backend", 8080), wl("ord", "backendx", 8081)] },
      { name: "db", workloads: [wl("db", "pg", 5432)] },
    ];
    const edges = [
      link("e1", "ord/backend", "db/pg", 5432),
      link("e2", "ord/backendx", "db/pg", 5432),
    ];
    const kept: Entry[] = [{ name: "backe", selector: { "app.kubernetes.io/name": "backend" } }];
    const out = buildPolicies(two, edges, "ord", kept) as Entry[];
    expect(out.map((e) => e.name)).toEqual(["backe", "back1"]);
  });

  test("values already in canonical form come back byte for byte", () => {
    const values = {
      policies: [
        {
          name: "core",
          enabled: true,
          serviceAccount: "backend",
          selector: { "app.kubernetes.io/name": "backend" },
          egress: [
            {
              to: [{ namespace: "db", selector: { "app.kubernetes.io/name": "pg" } }],
              ports: [{ port: 5432, protocol: "TCP" }],
            },
          ],
        },
      ],
    };
    const parsed = parseValues(values, "ord");
    expect(parsed.errors).toEqual([]);
    expect(buildPolicies(parsed.topology, parsed.edges, "ord", values.policies)).toEqual(
      values.policies,
    );
  });
});
