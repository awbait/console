import { describe, expect, test } from "bun:test";
import type { Edge } from "@xyflow/react";
import { type TopoNamespace, type TopoWorkload, workloadId } from "./topology";
import { partitionEdges } from "./valuesBuilder";
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
