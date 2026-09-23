import { findNodeAtOffset, type Node, parseTree } from "jsonc-parser";

// A "$ref" in a values.schema.json points at a definition further down the
// same document ("#/definitions/tls"). Read on screen it is a name to scroll
// for; this module makes it a place to jump to.

export type RefAt = {
  // The pointer as written, "#/definitions/tls".
  pointer: string;
  // The text of the pointer, between its quotes, as offsets into the document.
  from: number;
  to: number;
  // The name of the definition the pointer leads to, as offsets into the
  // document: for "#/definitions/tls" that is the "tls" key. Null when nothing
  // stands at the pointer, which is what the reader then needs to be told.
  target: { offset: number; length: number } | null;
};

// refAt says whether the offset stands inside the value of a "$ref" that points
// into this document, and where that pointer leads. Anything else, including a
// "$ref" to another file, is null: the editor has nothing to add there.
export function refAt(text: string, offset: number): RefAt | null {
  const root = parseTree(text);
  if (!root) return null;
  const node = findNodeAtOffset(root, offset, true);
  if (!node || node.type !== "string") return null;
  const property = node.parent;
  if (!property || property.type !== "property" || property.children?.[1] !== node) return null;
  if (property.children[0]?.value !== "$ref") return null;
  const pointer = String(node.value);
  if (!pointer.startsWith("#/")) return null;
  return {
    pointer,
    from: node.offset + 1,
    to: node.offset + node.length - 1,
    target: resolve(root, pointer),
  };
}

// resolve walks a JSON pointer down the parsed tree and returns the name of
// what it lands on: the key of a property, or the element itself inside a list.
// The segments are unescaped the way RFC 6901 writes them ("~1" is "/", "~0"
// is "~"), after the percent-encoding a URI fragment may carry.
function resolve(root: Node, pointer: string): { offset: number; length: number } | null {
  let segments: string[];
  try {
    segments = pointer
      .slice(2)
      .split("/")
      .map((s) => decodeURIComponent(s).replace(/~1/g, "/").replace(/~0/g, "~"));
  } catch {
    return null;
  }
  let node: Node = root;
  let name: Node | null = null;
  for (const seg of segments) {
    if (node.type === "object") {
      const property = (node.children ?? []).find((p) => p.children?.[0]?.value === seg);
      if (!property?.children?.[1]) return null;
      name = property.children[0];
      node = property.children[1];
    } else if (node.type === "array") {
      const index = /^\d+$/.test(seg) ? Number(seg) : -1;
      const element = (node.children ?? [])[index];
      if (!element) return null;
      name = element;
      node = element;
    } else {
      return null;
    }
  }
  return name ? { offset: name.offset, length: name.length } : null;
}

// refName is what the definition is called, for the hover: the last segment of
// the pointer, "tls" for "#/definitions/tls".
export function refName(pointer: string): string {
  const last = pointer.split("/").pop() ?? pointer;
  try {
    return decodeURIComponent(last).replace(/~1/g, "/").replace(/~0/g, "~");
  } catch {
    return last;
  }
}
