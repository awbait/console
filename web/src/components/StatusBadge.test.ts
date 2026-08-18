import { describe, expect, test } from "bun:test";
import type { RequestStatus } from "@/api/types";
import { STATUS_GROUPS, statusGroup, statusMeta, statusTitle } from "./StatusBadge";

// Every state the order FSM can be in (pkg/models/models.go). Written out here
// rather than derived from the groups: this is the list the backend can grow,
// and the test is what notices a state nobody has grouped yet.
const ALL_STATUSES: RequestStatus[] = [
  "DRAFT",
  "MR_CREATED",
  "MR_CLOSED",
  "MR_MERGED",
  "DEPLOYING",
  "HEALTHY",
  "DEGRADED",
  "ARGO_MISSING",
  "DELETE_REQUESTED",
  "DELETE_MR_MERGED",
  "DELETED",
];

describe("statusGroup", () => {
  test("every state of the order has a group to be shown in", () => {
    for (const s of ALL_STATUSES) expect(statusGroup(s)).not.toBeNull();
  });

  test("a state this build does not know has none", () => {
    expect(statusGroup("QUANTUM_SUPERPOSITION")).toBeNull();
  });

  test("the two ways a change is on its way read the same", () => {
    expect(statusMeta("MR_MERGED").label).toBe(statusMeta("DEPLOYING").label);
  });

  test("an ill service and one the cluster lost both read as not working", () => {
    expect(statusMeta("DEGRADED").label).toBe(statusMeta("ARGO_MISSING").label);
  });
});

describe("STATUS_GROUPS", () => {
  test("covers every state exactly once", () => {
    const covered = STATUS_GROUPS.flatMap((g) => g.statuses);
    expect([...covered].sort()).toEqual([...ALL_STATUSES].sort());
  });

  test("no group is empty", () => {
    for (const g of STATUS_GROUPS) expect(g.statuses.length).toBeGreaterThan(0);
  });
});

describe("labels", () => {
  test("say what happened to the service, not how the portal recorded it", () => {
    for (const s of ALL_STATUSES) {
      // Merge requests, branches and Git are the portal's own bookkeeping, and
      // Argo CD is the name of a system nobody ordered. None of them belong in
      // a badge the person who ordered the service reads.
      expect(statusMeta(s).label).not.toMatch(/\bMR\b|слияни|ветк|merge|git|argo/i);
    }
  });

  test("are written in Russian, in full words", () => {
    for (const s of ALL_STATUSES) {
      expect(statusMeta(s).label).toMatch(/^[А-ЯЁ][а-яё ]+$/);
    }
  });
});

describe("statusTitle", () => {
  test("plain by default: the group is all there is to read", () => {
    expect(statusTitle("MR_CREATED")).toBe("Сохраняем");
  });

  test("detailed adds the exact state, for whoever works out where an order is stuck", () => {
    expect(statusTitle("MR_CREATED", true)).toBe("Сохраняем (MR_CREATED)");
  });

  test("an unknown state is shown as it came, detailed or not", () => {
    expect(statusTitle("WAT", true)).toBe("WAT");
  });
});
