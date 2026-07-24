import { describe, expect, test } from "bun:test";
import type { Edge } from "@xyflow/react";
import { type TopoNamespace, type TopoWorkload, workloadId } from "./topology";
import { buildPolicies } from "./valuesBuilder";
import { parseValues } from "./valuesParser";
import { bodyHandleId, isBodyHandle, portFromHandle, portHandleId } from "./WorkloadNode";

function wl(ns: string, name: string, ports: number[]): TopoWorkload {
  return {
    id: workloadId(ns, name),
    name,
    kind: "Deployment",
    serviceAccount: `${name}-sa`,
    selector: { "app.kubernetes.io/name": name },
    ports: ports.map((port) => ({ port, protocol: "TCP" })),
  };
}

const topology: TopoNamespace[] = [
  { name: "ns1", workloads: [wl("ns1", "api", [8080])] },
  { name: "ns2", workloads: [wl("ns2", "db", [5432])] },
];

// A canvas arrow: from the source's body dot to the destination port.
function arrow(id: string, source: string, target: string, port: number): Edge {
  return {
    id,
    source,
    target,
    sourceHandle: bodyHandleId("r"),
    targetHandle: portHandleId(port, "l"),
  };
}

describe("values round trip", () => {
  test("a one-way arrow keeps its shape: body dot -> destination port", () => {
    const drawn = arrow("e1", workloadId("ns1", "api"), workloadId("ns2", "db"), 5432);
    const values = { policies: buildPolicies(topology, [drawn], "ns1") };
    const parsed = parseValues(values, "ns1");
    expect(parsed.errors).toEqual([]);
    expect(parsed.edges).toHaveLength(1);
    expect(isBodyHandle(parsed.edges[0].sourceHandle)).toBe(true);
    expect(portFromHandle(parsed.edges[0].targetHandle)).toBe(5432);
  });

  test("duplicated rules in hand-written values collapse into one arrow", () => {
    const rule = {
      to: [{ namespace: "ns2", selector: { "app.kubernetes.io/name": "db" } }],
      ports: [{ port: 5432, protocol: "TCP" }],
    };
    const values = {
      policies: [
        {
          name: "api",
          enabled: true,
          serviceAccount: "api-sa",
          selector: { "app.kubernetes.io/name": "api" },
          egress: [rule, rule, rule],
        },
      ],
    };
    const parsed = parseValues(values, "ns1");
    expect(parsed.errors).toEqual([]);
    expect(parsed.edges).toHaveLength(1);
  });

  test("mutual ingress and egress rules stay two opposite arrows", () => {
    // Shaped like a real config: the owner both receives from the peer and
    // calls it back. No two-way edge exists - two independent arrows.
    const values = {
      policies: [
        {
          name: "api",
          enabled: true,
          serviceAccount: "api-sa",
          selector: { "app.kubernetes.io/name": "api" },
          ingress: [
            {
              from: [{ namespace: "ns2", selector: { "app.kubernetes.io/name": "db" } }],
              ports: [{ port: 8080, protocol: "TCP" }],
            },
          ],
          egress: [
            {
              to: [{ namespace: "ns2", selector: { "app.kubernetes.io/name": "db" } }],
              ports: [{ port: 5432, protocol: "TCP" }],
            },
          ],
        },
      ],
    };
    const parsed = parseValues(values, "ns1");
    expect(parsed.errors).toEqual([]);
    expect(parsed.edges).toHaveLength(2);
    // Every arrow runs body dot -> destination port of its direction.
    const byTarget = new Map(
      parsed.edges.map((e) => [`${e.target}:${portFromHandle(e.targetHandle)}`, e]),
    );
    expect(byTarget.has(`${workloadId("ns1", "api")}:8080`)).toBe(true);
    expect(byTarget.has(`${workloadId("ns2", "db")}:5432`)).toBe(true);
    for (const e of parsed.edges) expect(isBodyHandle(e.sourceHandle)).toBe(true);
  });
});
