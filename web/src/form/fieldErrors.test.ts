import { describe, expect, test } from "bun:test";
import { fieldHint, fieldMsg, fieldRequirements } from "./fieldErrors";

describe("fieldRequirements", () => {
  // A hint states what the field takes; the error tells the reader what to do.
  // Same rule, and it must stay the same rule.
  test("says a name's rules, as requirements rather than instructions", () => {
    expect(
      fieldRequirements({
        type: "string",
        pattern: "^[a-z0-9]([a-z0-9-]*[a-z0-9])?$",
        maxLength: 63,
      }),
    ).toEqual([fieldHint.charset, fieldMsg.edgeChars, fieldMsg.maxLen(63)]);
  });

  test("a range is one rule, not two", () => {
    expect(fieldRequirements({ type: "integer", minimum: 1, maximum: 65535 })).toEqual([
      fieldHint.integer,
      fieldMsg.range(1, 65535),
    ]);
  });

  test("one-sided bounds keep their own wording", () => {
    expect(fieldRequirements({ type: "number", minimum: 1 })).toEqual([fieldMsg.min(1)]);
    expect(fieldRequirements({ type: "number", maximum: 10 })).toEqual([fieldMsg.max(10)]);
  });

  // A regular expression is not something to show a person: an unrecognised
  // pattern contributes nothing rather than leaking itself into the interface.
  test("an unknown pattern says nothing", () => {
    expect(fieldRequirements({ type: "string", pattern: "^(foo|bar)[0-9]{2}$" })).toEqual([]);
  });

  test("a field with no constraints has no rules", () => {
    expect(fieldRequirements({ type: "string" })).toEqual([]);
  });

  test("minLength 0 is not a rule anyone needs to read", () => {
    expect(fieldRequirements({ type: "string", minLength: 0, maxLength: 20 })).toEqual([
      fieldMsg.maxLen(20),
    ]);
  });
});
