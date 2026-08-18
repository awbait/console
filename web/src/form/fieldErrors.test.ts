import { describe, expect, test } from "bun:test";
import {
  dnsLabelError,
  dnsLabelRequirements,
  fieldHint,
  fieldKind,
  fieldMsg,
  fieldRequirements,
} from "./fieldErrors";
import { namespaceError, namespaceKind, namespaceRequirements } from "./namespace";

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

// The hand-written fields (service name, cluster, namespace) have no chart
// schema, so their rules come from dnsLabelRequirements. It has to say the same
// thing as dnsLabelError, which is the pair these tests watch.
describe("dnsLabelRequirements", () => {
  const met = (value: string) => dnsLabelRequirements().map((r) => r.met(value));

  test("states characters, edges and length, in that order", () => {
    expect(dnsLabelRequirements().map((r) => r.text)).toEqual([
      fieldHint.charset,
      fieldMsg.edgeChars,
      fieldMsg.maxLen(63),
    ]);
  });

  test("agrees with dnsLabelError on what is wrong", () => {
    expect(met("in-cluster")).toEqual([true, true, true]);
    expect(dnsLabelError("in-cluster")).toBeNull();

    expect(met("In-Cluster")).toEqual([false, false, true]);
    expect(dnsLabelError("In-Cluster")).toBe(fieldMsg.charset);

    expect(met("cluster-")).toEqual([true, false, true]);
    expect(dnsLabelError("cluster-")).toBe(fieldMsg.edgeChars);

    const long = "a".repeat(64);
    expect(met(long)).toEqual([true, true, false]);
    expect(dnsLabelError(long)).toBe(fieldMsg.maxLen(63));
  });

  test("the length rule follows the limit it was given", () => {
    expect(dnsLabelRequirements(9).map((r) => r.text)).toContain(fieldMsg.maxLen(9));
  });
});

// The namespace adds the backend's own rule: a name of nothing but digits is
// refused (validNamespace in internal/provisioning/service.go).
describe("namespaceRequirements", () => {
  const met = (value: string) => namespaceRequirements().map((r) => r.met(value));

  test("carries the DNS label rules and the letter one", () => {
    expect(namespaceRequirements()).toHaveLength(dnsLabelRequirements().length + 1);
    expect(met("payments")).toEqual([true, true, true, true]);
  });

  test("digits only fail the last rule, and only it", () => {
    expect(met("42")).toEqual([true, true, true, false]);
    expect(namespaceError("42")).toBe("Добавьте хотя бы одну букву.");
  });
});

// A kind is the pair - the rules and the check - handed to a field as one
// thing. What matters is that its two halves answer the same way: a field must
// not tick a rule off and then complain about it, or the other way round.
describe("fieldKind", () => {
  const agrees = (k: ReturnType<typeof fieldKind.dnsLabel>, value: string) => {
    const allMet = k.requirements.every((r) => r.met(value));
    return allMet === (k.error(value) === null);
  };

  test("dnsLabel: the hint and the complaint say the same thing", () => {
    for (const v of ["payments", "In-Cluster", "cluster-", "-x", "a".repeat(64), "42"]) {
      expect(agrees(fieldKind.dnsLabel(), v)).toBe(true);
    }
  });

  test("integerRange states both rules and complains about the first broken one", () => {
    const port = fieldKind.integerRange(1, 65535);
    expect(port.requirements.map((r) => r.text)).toEqual([
      fieldHint.integer,
      fieldMsg.range(1, 65535),
    ]);
    expect(port.error("8080")).toBeNull();
    expect(port.error("70000")).toBe(fieldMsg.range(1, 65535));
    expect(port.error("8o8o")).toBe(fieldMsg.integer);
  });

  test("an empty field is never wrong: whether it may be blank is the form's business", () => {
    expect(fieldKind.dnsLabel().error("")).toBeNull();
    expect(fieldKind.integerRange(1, 65535).error("")).toBeNull();
    expect(namespaceKind.error("")).toBeNull();
  });

  test("namespaceKind agrees with itself too", () => {
    for (const v of ["payments", "42", "Pay", "pay-"]) {
      const allMet = namespaceKind.requirements.every((r) => r.met(v));
      expect(allMet).toBe(namespaceKind.error(v) === null);
    }
  });
});
