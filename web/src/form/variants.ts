// A node whose value comes in one of several shapes.
//
// A chart says so with a oneOf, and the form draws a picker over the branches
// and the fields of the chosen one. An anyOf says the same thing just as often:
// RabbitMQ vhosts are a name or an object with the name and its settings, and
// the branches cannot both fit one value anyway. An anyOf is a variant when at
// least one branch has fields of its own. Without them it is a choice between
// bare types - a queue argument that is a string, a number or a boolean, "any
// JSON" - and stays the one input the form already draws for it (mapScalar.ts).

import { deref, type Schema } from "./fieldPath";

// variantsOf returns the branches of a variant node, dereferenced, or nothing
// when the node is not one.
export function variantsOf(s: Schema, root: Schema): Schema[] | undefined {
  if (Array.isArray(s.oneOf) && s.oneOf.length > 0) return s.oneOf.map((o: Schema) => deref(o, root));
  if (!Array.isArray(s.anyOf) || s.anyOf.length === 0) return undefined;
  const branches: Schema[] = s.anyOf.map((o: Schema) => deref(o, root));
  return branches.some((b) => holdsFields(b, root)) ? branches : undefined;
}

function holdsFields(b: Schema, root: Schema): boolean {
  return (b.type === "object" && !!b.properties) || variantsOf(b, root) !== undefined;
}

// fitsType says whether a value can belong to a branch by its JSON type alone. A
// branch with no single type, and a value not set yet, fit anything.
export function fitsType(branch: Schema, value: unknown): boolean {
  if (value === undefined || typeof branch.type !== "string") return true;
  switch (branch.type) {
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return true;
  }
}

// emptyOf is the value a branch starts with when the person picks it and its
// schema names no default: an object to put the fields in, an empty string for
// a string, so that the value already says which branch it is.
export function emptyOf(branch: Schema): unknown {
  if (branch.type === "string") return "";
  if (branch.type === "array") return [];
  if (branch.type === "object" || branch.properties) return {};
  return undefined;
}
