// What changed between two versions of an order's values, field by field.
//
// A change to a service is a change to a handful of settings, and that is what
// a person needs to see before they send it: not a file, not a patch, the
// fields and the two values. The same list answers the other question the
// portal has to ask - when two changes moved the same field, which value wins.
//
// Lists are compared whole, not element by element, exactly as the portal's own
// merge compares them (internal/provisioning/merge.go): a list in a chart's
// values is ordered and its entries carry meaning by position, so a per-element
// diff would describe a change nobody made.

import { sameValues } from "@/form/SchemaForm";

type Values = Record<string, unknown>;

// ValuesDiffRow is one field with something to say about it. A side is absent
// (undefined) when the field is not there at all: that is a field being added
// or removed, which is not the same as one being emptied.
export interface ValuesDiffRow {
  // Path is the dotted field path, e.g. "auth.database". It is the row's key
  // and the label of last resort, when no schema is around to give the field
  // the name it had on the form.
  path: string;
  // Field is the same path in segments. A field name may contain a dot (an
  // annotation key), so only the segments say where the field really is.
  field: string[];
  // Label overrides the name the schema would give the field. Set for the one
  // row that is not a values field at all: the chart version.
  label?: string;
  before?: unknown;
  after?: unknown;
}

function isTree(v: unknown): v is Values {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// diffValues lists every field the two trees disagree on, ordered by path so
// the same change always reads the same way.
export function diffValues(before: unknown, after: unknown): ValuesDiffRow[] {
  const rows: ValuesDiffRow[] = [];
  walk(isTree(before) ? before : {}, isTree(after) ? after : {}, [], rows);
  rows.sort((a, b) => a.path.localeCompare(b.path));
  return rows;
}

function walk(before: Values, after: Values, prefix: string[], out: ValuesDiffRow[]): void {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const b = before[key];
    const a = after[key];
    const field = [...prefix, key];
    // Both sides still hold a subtree here: look inside it rather than calling
    // the whole branch one changed value. A side that replaced the subtree with
    // something else falls through to the value comparison.
    if (isTree(b) && isTree(a)) {
      walk(b, a, field, out);
      continue;
    }
    if (sameValues(b, a)) continue;
    out.push({ path: field.join("."), field, before: b, after: a });
  }
}

// setAtField returns a copy of the tree with one field set, or removed when the
// value is undefined - the field was not there on the side that was chosen, and
// putting an empty one in its place would resurrect a setting nobody asked for.
// Objects along the way are copied, never edited in place.
export function setAtField(values: Values, field: string[], value: unknown): Values {
  if (field.length === 0) return values;
  const [key, ...rest] = field;
  const copy: Values = { ...values };
  if (rest.length === 0) {
    if (value === undefined) delete copy[key];
    else copy[key] = value;
    return copy;
  }
  const next = copy[key];
  copy[key] = setAtField(isTree(next) ? next : {}, rest, value);
  return copy;
}

// formatValue writes a value the way it should be read, not the way it is
// stored. Only the shapes a chart's values actually hold are worth spelling
// out; anything else falls back to its JSON, which is at least honest.
export function formatValue(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "да" : "нет";
  if (v === null) return "не задано";
  if (Array.isArray(v)) {
    if (v.length === 0) return "пусто";
    // A list of plain values reads as a list; a list of objects has no short
    // form, so it keeps its JSON.
    return v.every((x) => x === null || typeof x !== "object")
      ? v.map((x) => formatValue(x)).join(", ")
      : JSON.stringify(v, null, 2);
  }
  if (typeof v === "object") return JSON.stringify(v, null, 2);
  return String(v);
}

// isBlock reports whether a formatted value needs room of its own: the JSON of
// a list of objects is not something to squeeze onto one line.
export function isBlock(v: unknown): boolean {
  return typeof v === "object" && v !== null && formatValue(v).includes("\n");
}
