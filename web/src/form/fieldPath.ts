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

// ifMatches evaluates a JSON Schema "if" against a value for the subset charts
// use: properties with const/enum, plus the if's own required (presence) list.
export function ifMatches(ifSchema: Schema, value: Record<string, unknown>, root: Schema): boolean {
  for (const [k, cond] of Object.entries(ifSchema.properties ?? {})) {
    const c = deref(cond as Schema, root);
    const v = value?.[k];
    if ("const" in c && v !== c.const) return false;
    if (Array.isArray(c.enum) && !c.enum.includes(v)) return false;
  }
  for (const k of ifSchema.required ?? []) if (value?.[k] === undefined) return false;
  return true;
}

// matchedThens returns the "then" schemas of the if/then branches (top-level and
// inside allOf) whose condition holds for the current value.
export function matchedThens(schema: Schema, value: Record<string, unknown>, root: Schema): Schema[] {
  const branches: Schema[] = [];
  if (schema.if) branches.push(schema);
  for (const a of (schema.allOf as Schema[]) ?? []) if (a.if) branches.push(a);
  return branches
    .filter((b) => b.then && ifMatches(b.if, value ?? {}, root))
    .map((b) => b.then as Schema);
}

// pinnedAt answers what a field is pinned to right now, or undefined when
// nothing pins it: the value a satisfied if/then branch fixes it at.
//
// A chart ties two fields together this way - an egress gateway in direct mode
// must not create the waypoint namespace - and the rule is declared where both
// fields are visible, which is usually the root. So the branch lives one place
// and the field it pins lives another, and reading the field's own node says
// nothing about it: that is why the portal used to answer "значение не
// подходит" and leave the person to guess which value would.
export function pinnedAt(pointer: string, root: Schema, values: unknown): unknown | undefined {
  const segs = pointer.split("/").filter(Boolean).map(decodeURIComponent);
  let node: Schema = deref(root, root);
  let value: unknown = values;
  for (let i = 0; i < segs.length; i++) {
    const branches = matchedThens(node, (value ?? {}) as Record<string, unknown>, root);
    for (const then of branches) {
      const pinned = resolveConst(then, segs.slice(i), root);
      if (pinned !== undefined) return pinned;
    }
    const next = node.properties?.[segs[i]];
    if (!next) return undefined;
    node = deref(next, root);
    value = (value as Record<string, unknown> | undefined)?.[segs[i]];
  }
  return undefined;
}

// resolveConst walks a "then" branch down a path of field names and answers with
// the const it pins there, if it pins one.
function resolveConst(then: Schema, path: string[], root: Schema): unknown | undefined {
  let node: Schema | undefined = then;
  for (const seg of path) {
    const next = node?.properties?.[seg];
    if (!next) return undefined;
    node = deref(next, root);
  }
  return node && "const" in node ? node.const : undefined;
}

// fieldBreadcrumb turns a JSON Pointer into a friendly path that mirrors the
// form: it prefers view-override titles (e.g. "Gateway"), drops the array index
// of a ui:widget:"single" field (one item, the index is noise), and shows other
// array indices as human "#N". Without a schema it falls back to raw keys.
export function fieldBreadcrumb(pointer: string, root?: Schema, view?: Schema): string {
  let segs = pointer.split("/").filter(Boolean).map(decodeURIComponent);
  let node: Schema | undefined = root ? deref(root, root) : undefined;
  let curView: Schema | undefined = view;
  let skipIndex = false;
  let out = "";
  // A view reaches into a subchart by a path ("waypointNamespace/enabled") and
  // titles the field there. The form draws that field as one field with that
  // title, so the error summary calls it the same thing instead of walking the
  // path and naming the block it happens to sit in ("Namespace гейтвея › Enabled",
  // neither half of which is on screen anywhere).
  const named = namedByView(segs, curView);
  if (named) {
    out = named.title;
    skipIndex = named.singleWidget;
    segs = segs.slice(named.depth);
    node = root ? nodeAt(pointer.split("/").filter(Boolean).slice(0, named.depth).join("/"), root) : undefined;
    curView = named.childView;
  }
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

// namedByView finds the longest run of leading segments a view has titled as one
// field, which is the name the person saw. Nothing matched means the path is an
// ordinary walk through the schema.
function namedByView(
  segs: string[],
  view: Schema | undefined,
): { title: string; depth: number; singleWidget: boolean; childView: Schema | undefined } | undefined {
  const overrides = view?.overrides as Record<string, Schema> | undefined;
  if (!overrides) return undefined;
  for (let depth = segs.length; depth > 1; depth--) {
    const o = overrides[segs.slice(0, depth).join("/")];
    if (typeof o?.title === "string") {
      return {
        title: o.title,
        depth,
        singleWidget: o["ui:widget"] === "single",
        childView: o["ui:view"] as Schema | undefined,
      };
    }
  }
  return undefined;
}

// pointerOf builds a JSON Pointer from path segments. Field names are taken as
// they are, including the "/" and "~" a Kubernetes annotation key carries, which
// is the whole reason the segments travel separately from the dotted path.
export function pointerOf(field: string[]): string {
  return field.map((s) => `/${s.replace(/~/g, "~0").replace(/\//g, "~1")}`).join("");
}
