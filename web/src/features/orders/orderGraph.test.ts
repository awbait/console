import { describe, expect, test } from "bun:test";
import type { OrderRequest, RequestMR, ViewDocument } from "@/api/types";
import { defaultMapping } from "../graph/mapping";
import { entriesHiddenFromTabs, entryCount, graphFor, graphLock, sameValues } from "./orderGraph";

const policiesDoc: ViewDocument = { views: { order: {} }, graph: { profile: "policies" } } as ViewDocument;

describe("graphFor", () => {
  test("a version that declares the graph gets one", () => {
    const graph = graphFor(policiesDoc);
    expect(graph?.plugin.label).toBe("Граф");
    expect(graph?.mapping.entries).toBe("/policies");
  });

  test("no graph block, no graph", () => {
    expect(graphFor({ views: { order: {} } })).toBeNull();
    expect(graphFor(null)).toBeNull();
  });

  test("a profile this portal does not implement gets none", () => {
    expect(graphFor({ graph: { profile: "quotas" } } as ViewDocument)).toBeNull();
  });

  test("a block switched off gets none", () => {
    expect(graphFor({ graph: { profile: "policies", enabled: false } } as ViewDocument)).toBeNull();
  });
});

describe("graphLock", () => {
  const live = { status: "HEALTHY", drifted: false } as Pick<OrderRequest, "status" | "drifted">;
  const mr = { mr_iid: 42 } as RequestMR;

  test("a live order with rights is a drawing surface", () => {
    expect(graphLock(live, true, null)).toBeNull();
  });

  test("no rights: view only, whatever the status", () => {
    expect(graphLock(live, false, null)?.reason).toBe("forbidden");
  });

  test("a change already in flight blocks, without naming the machinery", () => {
    const lock = graphLock(live, true, mr);
    expect(lock?.reason).toBe("open_mr");
    // The person on this screen is saving their service: merge requests,
    // branches and Git are the portal's business, not theirs.
    expect(lock?.text).not.toMatch(/слияни|merge|git|ветк/i);
  });

  test("a draft sends the user to the order form", () => {
    expect(graphLock({ status: "DRAFT", drifted: false }, true, null)?.reason).toBe("draft");
  });

  test("drift blocks: a change would land on top of someone else's", () => {
    expect(graphLock({ status: "HEALTHY", drifted: true }, true, null)?.reason).toBe("drifted");
  });

  test("a status an update cannot be opened from blocks", () => {
    expect(graphLock({ status: "MR_CREATED", drifted: false }, true, null)?.reason).toBe("status");
    expect(graphLock({ status: "DELETED", drifted: false }, true, null)?.reason).toBe("status");
  });

  test("rights are checked before anything else, so the reason is the honest one", () => {
    expect(graphLock({ status: "DRAFT", drifted: true }, false, mr)?.reason).toBe("forbidden");
  });
});

describe("sameValues", () => {
  test("key order is not a change", () => {
    expect(sameValues({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  test("a different value is", () => {
    expect(sameValues({ policies: [{ name: "a" }] }, { policies: [{ name: "b" }] })).toBe(false);
  });

  test("an added key is", () => {
    expect(sameValues({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});

describe("entryCount", () => {
  const mapping = defaultMapping("policies");

  test("counts the entries of the mapped section", () => {
    expect(entryCount({ policies: [{}, {}] }, mapping)).toBe(2);
  });

  test("a missing or malformed section counts as none", () => {
    expect(entryCount({}, mapping)).toBe(0);
    expect(entryCount({ policies: "no" }, mapping)).toBe(0);
  });

  test("follows a nested pointer", () => {
    expect(entryCount({ net: { policies: [{}] } }, { ...mapping, entries: "/net/policies" })).toBe(1);
  });
});

describe("entriesHiddenFromTabs", () => {
  const mapping = defaultMapping("policies");
  const byIndex = {
    ...policiesDoc,
    tabs: [
      { id: "ingress", form: "ingress", items: "/policies/0/ingress", title: "Ingress правила" },
      { id: "egress", form: "egress", items: "/policies/0/egress", title: "Egress правила" },
    ],
  } as ViewDocument;

  test("tabs pinned to the first entry cannot show a second one", () => {
    expect(entriesHiddenFromTabs(byIndex, mapping, 2)).toBe(true);
  });

  test("one entry hides nothing", () => {
    expect(entriesHiddenFromTabs(byIndex, mapping, 1)).toBe(false);
  });

  test("tabs over the whole array show everything", () => {
    const whole = {
      ...policiesDoc,
      tabs: [{ id: "policies", form: "policy", items: "/policies", title: "Политики" }],
    } as ViewDocument;
    expect(entriesHiddenFromTabs(whole, mapping, 3)).toBe(false);
  });
});
