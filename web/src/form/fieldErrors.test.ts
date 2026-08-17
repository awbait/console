import { describe, expect, test } from "bun:test";
import { fieldHint, fieldMsg, fieldRequirements } from "./fieldErrors";

const texts = (s: Parameters<typeof fieldRequirements>[0]) =>
  fieldRequirements(s).map((r) => r.text);

// Which rules a field states.
describe("fieldRequirements", () => {
  // A hint states what the field takes; the error tells the reader what to do.
  // Same rule, and it must stay the same rule.
  test("says a name's rules, as requirements rather than instructions", () => {
    expect(
      texts({ type: "string", pattern: "^[a-z0-9]([a-z0-9-]*[a-z0-9])?$", maxLength: 63 }),
    ).toEqual([fieldHint.charset, fieldMsg.edgeChars, fieldMsg.maxLen(63)]);
  });

  test("a range is one rule, not two", () => {
    expect(texts({ type: "integer", minimum: 1, maximum: 65535 })).toEqual([
      fieldHint.integer,
      fieldMsg.range(1, 65535),
    ]);
  });

  test("one-sided bounds keep their own wording", () => {
    expect(texts({ type: "number", minimum: 1 })).toEqual([fieldMsg.min(1)]);
    expect(texts({ type: "number", maximum: 10 })).toEqual([fieldMsg.max(10)]);
  });

  // A regular expression is not something to show a person: an unrecognised
  // pattern contributes nothing rather than leaking itself into the interface.
  test("an unknown pattern says nothing", () => {
    expect(texts({ type: "string", pattern: "^(foo|bar)[0-9]{2}$" })).toEqual([]);
  });

  test("a field with no constraints has no rules", () => {
    expect(texts({ type: "string" })).toEqual([]);
  });

  test("minLength 0 is not a rule anyone needs to read", () => {
    expect(texts({ type: "string", minLength: 0, maxLength: 20 })).toEqual([fieldMsg.maxLen(20)]);
  });
});

// Whether the value in the field satisfies them: this is what the form ticks
// off while a person types.
describe("fieldRequirements checks", () => {
  const dns = { type: "string", pattern: "^[a-z0-9]([a-z0-9-]*[a-z0-9])?$", minLength: 2, maxLength: 9 };
  const met = (value: string) => fieldRequirements(dns).map((r) => r.met(value));

  test("a good name meets every rule", () => {
    expect(met("payments")).toEqual([true, true, true, true]);
  });

  test("capitals fail the character rule, and only it", () => {
    // "Pay" is long enough and short enough; it is the alphabet that is wrong.
    expect(met("Pay")).toEqual([false, false, true, true]);
  });

  test("a trailing hyphen fails only the edge rule", () => {
    expect(met("pay-")).toEqual([true, false, true, true]);
  });

  test("too short and too long are separate answers", () => {
    expect(met("p")).toEqual([true, true, false, true]);
    expect(met("paymentsystem")).toEqual([true, true, true, false]);
  });

  test("a number in range, and out of it", () => {
    const port = fieldRequirements({ type: "integer", minimum: 1, maximum: 65535 });
    expect(port.map((r) => r.met("8080"))).toEqual([true, true]);
    expect(port.map((r) => r.met("70000"))).toEqual([true, false]);
    // Half-typed input satisfies no bound rather than counting as zero.
    expect(port.map((r) => r.met("-"))).toEqual([false, false]);
  });
});
