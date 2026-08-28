import { describe, expect, test } from "bun:test";
import { isLive, LIVE_STATUSES } from "./orderStatus";
import type { RequestStatus } from "./types";

// The states an order can be in, written out rather than derived: this is the
// list the backend can grow, and the test is what notices a new one nobody has
// decided about (pkg/models/models.go).
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

describe("isLive", () => {
  test("a service exists from the merged create change until it is taken out", () => {
    for (const s of LIVE_STATUSES) expect(isLive(s)).toBe(true);
  });

  test("nothing before the create change is merged counts as a service", () => {
    for (const s of ["DRAFT", "MR_CREATED", "MR_CLOSED"] as RequestStatus[]) {
      expect(isLive(s)).toBe(false);
    }
  });

  test("an order on its way out does not count either", () => {
    for (const s of ["DELETE_REQUESTED", "DELETE_MR_MERGED", "DELETED"] as RequestStatus[]) {
      expect(isLive(s)).toBe(false);
    }
  });

  test("every state is decided one way or the other", () => {
    const decided = new Set([
      ...LIVE_STATUSES,
      "DRAFT",
      "MR_CREATED",
      "MR_CLOSED",
      "DELETE_REQUESTED",
      "DELETE_MR_MERGED",
      "DELETED",
    ]);
    for (const s of ALL_STATUSES) expect(decided.has(s)).toBe(true);
  });

  test("a state this build does not know is not live", () => {
    expect(isLive("QUANTUM_SUPERPOSITION")).toBe(false);
  });
});
