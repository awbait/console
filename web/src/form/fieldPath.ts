// Naming a field the way the form names it.
//
// Everything that talks to a person about one field of the values - the error
// summary under a form, the list of what a change moves, the two values a
// conflict is stuck between - has the same problem: it holds a path into the
// values tree ("auth/database") and owes the reader the label they saw on the
// form ("Доступ › База данных"). The walk that turns one into the other lives
// here, so those three never drift apart on what a field is called.

export type Schema = Record<string, any>;

// deref follows $ref (merging siblings), like the form's resolver, so the walk
// can reach titles that live behind a reference.
export function deref(node: Schema | undefined, root: Schema): Schema {
  let n: Schema = node ?? {};
  let guard = 0;
  while (n && typeof n === "object" && typeof n.$ref === "string" && guard++ < 20) {
    const { $ref, ...rest } = n;
    let t: any = root;
    if ($ref.startsWith("#/")) for (const p of $ref.slice(2).split("/")) t = t?.[decodeURIComponent(p)];
    n = { ...(t ?? {}), ...rest };
  }
  return n;
}

// nodeAt resolves the schema node at a JSON Pointer into the values.
export function nodeAt(pointer: string, root: Schema): Schema | undefined {
  let node: Schema | undefined = deref(root, root);
  for (const seg of pointer.split("/").filter(Boolean).map(decodeURIComponent)) {
    if (!node) return undefined;
    node = /^\d+$/.test(seg)
      ? deref(node.items ?? {}, root)
      : node.properties?.[seg]
        ? deref(node.properties[seg], root)
        : undefined;
  }
  return node;
}

// fieldBreadcrumb turns a JSON Pointer into a friendly path that mirrors the
// form: it prefers view-override titles (e.g. "Gateway"), drops the array index
// of a ui:widget:"single" field (one item, the index is noise), and shows other
// array indices as human "#N". Without a schema it falls back to raw keys.
export function fieldBreadcrumb(pointer: string, root?: Schema, view?: Schema): string {
  const segs = pointer.split("/").filter(Boolean).map(decodeURIComponent);
  let node: Schema | undefined = root ? deref(root, root) : undefined;
  let curView: Schema | undefined = view;
  let skipIndex = false;
  let out = "";
  for (const seg of segs) {
    if (/^\d+$/.test(seg)) {
      if (skipIndex) skipIndex = false; // single widget: omit the [0]
      else out += out ? ` #${Number(seg) + 1}` : `#${Number(seg) + 1}`;
      node = node && root ? deref(node.items ?? {}, root) : undefined;
    } else {
      const override = curView?.overrides?.[seg] as Schema | undefined;
      const schemaTitle = root && node?.properties?.[seg] ? deref(node.properties[seg], root).title : undefined;
      const text = override?.title ?? schemaTitle ?? seg;
      out = out ? `${out} › ${text}` : text;
      skipIndex = override?.["ui:widget"] === "single";
      node = node?.properties?.[seg] && root ? deref(node.properties[seg], root) : undefined;
      curView = override?.["ui:view"] as Schema | undefined;
    }
  }
  return out;
}

// pointerOf builds a JSON Pointer from path segments. Field names are taken as
// they are, including the "/" and "~" a Kubernetes annotation key carries, which
// is the whole reason the segments travel separately from the dotted path.
export function pointerOf(field: string[]): string {
  return field.map((s) => `/${s.replace(/~/g, "~0").replace(/\//g, "~1")}`).join("");
}
