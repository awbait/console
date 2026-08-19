import { deref } from "@/form/SchemaForm";

// The fields of one chart version, listed as the paths a view document writes.
//
// The version constructor is written by hand, and the half nobody can hold in
// their head is not "which keys does a view document have" (the format schema
// answers that) but "what is in THIS chart": what to put in "items", which
// pointer belongs in "ui:table.path", what "include" may name. That lives in the
// version's values.schema.json, which the page already loads, so the answer is a
// walk over it.

type Schema = Record<string, any>;

// What a field is, so a suggestion can be filtered by what the key expects:
// "items" wants an array, "identity" a single value, "include" a name.
export type FieldKind = "array" | "object" | "map" | "scalar";

export type ChartField = {
  path: string;
  kind: FieldKind;
  title?: string;
  description?: string;
};

// How an array is stepped through on the way to a nested field. A JSON pointer
// picks one element by index ("/policies/0/ingress"), a table column iterates
// with a star ("from/*/namespace"). Both conventions are in daily use and are
// the thing authors mix up most, which is half the reason for suggesting at all.
export type ArrayStep = "index" | "star";

export type WalkOptions = {
  arrays: ArrayStep;
  // Leading "/": a pointer has one, a column path inside a row does not.
  absolute: boolean;
};

// A chart is described once and read many times, but a schema with a recursive
// $ref would walk forever. Depth and count are what stops it, and both sit well
// above any real chart (the widest one here has three levels and ~90 fields).
const MAX_DEPTH = 6;
const MAX_FIELDS = 500;

// chartFields lists every field reachable from a schema node, in the form the
// key being edited expects. The node is the root of values.schema.json for an
// absolute pointer, or one list row for a column path.
export function chartFields(node: Schema | null | undefined, root: Schema, opts: WalkOptions): ChartField[] {
  if (!node) return [];
  const out: ChartField[] = [];
  walk(node, root, "", 0, out, opts);
  if (opts.absolute) return out;
  return out.map((f) => ({ ...f, path: f.path.slice(1) }));
}

// rowOf returns the schema of one row of a list: what a tab's columns and its
// element form are written against. Undefined when the node is not a described
// list, and then there is nothing to suggest rather than something wrong.
export function rowOf(node: Schema | null | undefined, root: Schema): Schema | undefined {
  if (!node) return undefined;
  const s = deref(node, root);
  if (!s.items) return undefined;
  return deref(s.items, root);
}

// nodeAt follows a JSON pointer over the values (for example
// /gateways/0/listeners) down the chart schema: a numeric segment steps into a
// list row, a name into a property.
export function nodeAt(pointer: string, root: Schema): Schema | undefined {
  let cur: Schema | undefined = deref(root, root);
  for (const seg of pointer.replace(/^\//, "").split("/")) {
    if (!seg || !cur) continue;
    if (/^\d+$/.test(seg)) {
      cur = cur.items ? deref(cur.items, root) : undefined;
      continue;
    }
    const next = properties(cur, root)[seg];
    cur = next ? deref(next, root) : undefined;
  }
  return cur;
}

// properties merges a node's own properties with those of its allOf/oneOf/anyOf
// and then/else branches: a chart may describe a field only inside a condition,
// and the form renders it all the same.
export function properties(node: Schema | null | undefined, root: Schema): Record<string, Schema> {
  const out: Record<string, Schema> = {};
  if (!node) return out;
  const collect = (n: Schema, depth: number) => {
    if (depth > 4) return;
    const s = deref(n, root);
    for (const [k, v] of Object.entries(s.properties ?? {})) {
      if (!(k in out)) out[k] = v as Schema;
    }
    for (const branch of ["allOf", "oneOf", "anyOf"] as const) {
      for (const b of (s[branch] as Schema[]) ?? []) collect(b, depth + 1);
    }
    for (const branch of ["then", "else"] as const) {
      if (s[branch]) collect(s[branch] as Schema, depth + 1);
    }
  };
  collect(node, 0);
  return out;
}

function kindOf(s: Schema, root: Schema): FieldKind {
  if (s.type === "array" || s.items) return "array";
  if (Object.keys(properties(s, root)).length > 0) return "object";
  if (s.additionalProperties && typeof s.additionalProperties === "object") return "map";
  return s.type === "object" ? "object" : "scalar";
}

function walk(node: Schema, root: Schema, prefix: string, depth: number, out: ChartField[], opts: WalkOptions) {
  if (depth >= MAX_DEPTH || out.length >= MAX_FIELDS) return;
  for (const [key, raw] of Object.entries(properties(node, root))) {
    const child = deref(raw, root);
    const path = `${prefix}/${key}`;
    const kind = kindOf(child, root);
    out.push({ path, kind, title: str(child.title), description: str(child.description) });
    if (out.length >= MAX_FIELDS) return;
    switch (kind) {
      case "array": {
        const row = child.items ? deref(child.items, root) : undefined;
        if (row) walk(row, root, `${path}/${opts.arrays === "index" ? "0" : "*"}`, depth + 1, out, opts);
        break;
      }
      case "map": {
        // The keys of a string-keyed map belong to whoever fills the values in,
        // so there is nothing to name here. A column path can still walk through
        // one: "*key" reads the keys, "*val" the values behind them.
        if (opts.arrays !== "star") break;
        out.push({ path: `${path}/*key`, kind: "scalar", title: str(child.title) });
        walk(deref(child.additionalProperties, root), root, `${path}/*val`, depth + 1, out, opts);
        break;
      }
      default:
        walk(child, root, path, depth + 1, out, opts);
    }
  }
}

// A chart's title/description are written by hand, so anything but a string is
// treated as absent rather than shown.
function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}
