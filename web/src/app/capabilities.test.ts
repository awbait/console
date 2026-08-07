import { describe, expect, test } from "bun:test";
import { CAPABILITIES, capabilityText } from "./capabilities";

// The ids the backend reports (internal/status/capabilities.go). A capability
// added there without wording here would reach the user as a bare identifier,
// so this list is the contract between the two files.
const BACKEND_IDS = ["sign_in", "catalog", "ordering", "orders", "deploy_status", "publishing"];

describe("capabilities", () => {
  test("every backend capability has wording", () => {
    expect(Object.keys(CAPABILITIES).sort()).toEqual([...BACKEND_IDS].sort());
  });

  test("wording is a finished sentence addressed to the user", () => {
    for (const [id, text] of Object.entries(CAPABILITIES)) {
      expect(text.label.length, `${id}: label`).toBeGreaterThan(0);
      // Product copy, not a spec: no trailing label period, and the impact is a
      // sentence that ends like one.
      expect(text.label.endsWith("."), `${id}: label ends with a period`).toBe(false);
      expect(text.impact.endsWith("."), `${id}: impact ends with a period`).toBe(true);
      expect(text.impact.includes(";"), `${id}: impact uses a semicolon`).toBe(false);
    }
  });

  test("an unknown id still reads as a sentence", () => {
    const t = capabilityText("something_new");
    expect(t.label).not.toContain("something_new");
    expect(t.impact.endsWith(".")).toBe(true);
  });
});
