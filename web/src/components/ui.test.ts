import { describe, expect, test } from "bun:test";
import { fieldKind } from "@/form/fieldErrors";
import { namespaceKind } from "@/form/namespace";
import { hintIsOpen } from "./ui";

// When the rules panel of a field is up. It is the panel that covers whatever
// sits under the field, so the answer decides whether a dialog button is
// reachable while the caret is still in the field above it (issue #351).
describe("hintIsOpen", () => {
  const rules = namespaceKind.requirements;
  const open = (typing: boolean, hovered: boolean, value: string) =>
    hintIsOpen({ typing, hovered, rules, value });

  test("closed when the field is not being filled in and nobody hovers the icon", () => {
    expect(open(false, false, "")).toBe(false);
    expect(open(false, false, "payments")).toBe(false);
  });

  test("open on an empty field: a rule that is true of nothing is not an answer", () => {
    expect(open(true, false, "")).toBe(true);
    expect(open(true, false, "   ")).toBe(true);
  });

  test("open while the value still breaks a rule", () => {
    expect(open(true, false, "Payments")).toBe(true);
    expect(open(true, false, "payments-")).toBe(true);
    expect(open(true, false, "42")).toBe(true);
  });

  test("closed once every rule is ticked off, so the button below is free", () => {
    expect(open(true, false, "payments")).toBe(false);
  });

  // The two halves of a kind agree (see fieldErrors.test.ts), so the panel
  // stands exactly while the field would complain, and the primary button of a
  // dialog is disabled for the same values. The two can never fight over the
  // same click.
  test("stands exactly while the value is one the field complains about", () => {
    for (const v of ["payments", "42", "Pay", "pay-", "a-b-c"]) {
      expect(open(true, false, v)).toBe(namespaceKind.error(v) !== null);
    }
  });

  test("hovering the icon opens it whatever the value is", () => {
    expect(open(false, true, "payments")).toBe(true);
    expect(open(true, true, "payments")).toBe(true);
  });

  test("a field without rules never opens by the caret alone", () => {
    expect(hintIsOpen({ typing: true, hovered: false, rules: [], value: "x" })).toBe(false);
    expect(hintIsOpen({ typing: true, hovered: false, rules: [], value: "" })).toBe(true);
  });

  test("the same holds for a kind built from a chart schema", () => {
    const label = fieldKind.dnsLabel(9);
    const openFor = (v: string) =>
      hintIsOpen({ typing: true, hovered: false, rules: label.requirements, value: v });
    expect(openFor("gateway-1")).toBe(false);
    expect(openFor("gateway-12")).toBe(true);
    expect(openFor("-x")).toBe(true);
  });
});
