import { describe, expect, test } from "bun:test";
import { formVersionOptions, orderCapabilityForStand } from "./orderForm";

describe("formVersionOptions", () => {
  test("returns orderable versions as-is for a new order", () => {
    expect(formVersionOptions(["2.0.0", "1.0.0"])).toEqual(["2.0.0", "1.0.0"]);
    expect(formVersionOptions(["1.0.0"])).toEqual(["1.0.0"]);
    expect(formVersionOptions([])).toEqual([]);
  });

  test("returns orderable versions as-is when draft version is still orderable", () => {
    expect(formVersionOptions(["2.0.0", "1.0.0"], "1.0.0")).toEqual(["2.0.0", "1.0.0"]);
  });

  test("appends retired draft version so the user can move off it", () => {
    expect(formVersionOptions(["2.0.0"], "1.0.0")).toEqual(["2.0.0", "1.0.0"]);
  });

  test("returns empty for legacy charts without an orderable allowlist", () => {
    expect(formVersionOptions([], "1.0.0")).toEqual([]);
  });
});

describe("orderCapabilityForStand", () => {
  test("uses catalog capability for console-only stands", () => {
    expect(orderCapabilityForStand("console")).toBe("catalog");
  });

  test("uses ordering capability for git-backed and unknown stands", () => {
    expect(orderCapabilityForStand("deploy")).toBe("ordering");
    expect(orderCapabilityForStand("git")).toBe("ordering");
    expect(orderCapabilityForStand(undefined)).toBe("ordering");
  });
});
