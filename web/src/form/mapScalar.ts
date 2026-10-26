// A map whose entries may be "any scalar".
//
// A RabbitMQ queue argument is a string, a number, a boolean or null, and the
// chart says so with an anyOf over those types. The form draws such an entry as
// one text input, which leaves two questions: what value the typed text stands
// for, and what text shows a value so that it reads back to the same value. The
// answers follow YAML, which is where the values end up: "5" is a number where
// the entry admits one, "true" a boolean, "null" null, and text in matching
// quotes is the string inside them, which is how a string that only looks like
// a number stays a string.

import { deref, type Schema } from "./fieldPath";

export type ScalarType = "string" | "integer" | "number" | "boolean" | "null";

const SCALARS: ReadonlySet<string> = new Set<ScalarType>(["string", "integer", "number", "boolean", "null"]);

const INT_RE = /^-?\d+$/;
const NUM_RE = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

// scalarTypesOf names the scalar types an entry admits when it is a choice
// between several: an anyOf or oneOf of typed branches, or a list of types.
// Nothing when the entry is anything else - one type, which the form draws as
// that type's own control, or a choice with an object or a list in it, which
// stays text. A oneOf of bare types is the same choice to the person typing;
// whether a value fits exactly one branch is the server's to say.
export function scalarTypesOf(entry: Schema, root: Schema): ReadonlySet<ScalarType> | undefined {
  const choice = Array.isArray(entry.anyOf) ? entry.anyOf : Array.isArray(entry.oneOf) ? entry.oneOf : undefined;
  let branches: Schema[];
  if (choice) branches = choice.map((b: Schema) => deref(b, root));
  else if (Array.isArray(entry.type)) branches = entry.type.map((t: unknown) => ({ type: t }));
  else return undefined;
  if (branches.length === 0) return undefined;
  const out = new Set<ScalarType>();
  for (const b of branches) {
    if (typeof b.type !== "string" || !SCALARS.has(b.type)) return undefined;
    out.add(b.type as ScalarType);
  }
  return out;
}

// parseScalar reads typed text into the value it stands for among the types
// the entry admits. Text that stands for none of them is the string itself,
// whitespace and all.
export function parseScalar(text: string, types: ReadonlySet<ScalarType>): unknown {
  const t = text.trim();
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) return t.slice(1, -1);
  if (types.has("null") && t === "null") return null;
  if (types.has("boolean") && (t === "true" || t === "false")) return t === "true";
  if ((types.has("integer") || types.has("number")) && INT_RE.test(t)) {
    // Digits past what a number holds exactly stay text rather than lose them.
    const n = Number(t);
    return Number.isSafeInteger(n) ? n : text;
  }
  if (types.has("number") && NUM_RE.test(t)) {
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  return text;
}

// scalarText shows a value as text that reads back to the same value: a number,
// a boolean and null as they are written, a string as itself unless it would
// read as something else, in which case it is quoted.
export function scalarText(v: unknown, types: ReadonlySet<ScalarType>): string {
  if (v === undefined) return "";
  if (v === null) return "null";
  if (typeof v !== "string") return String(v);
  if (parseScalar(v, types) === v) return v;
  return v.includes('"') ? `'${v}'` : `"${v}"`;
}
