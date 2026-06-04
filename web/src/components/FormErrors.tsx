import { IconAlertTriangle } from "@tabler/icons-react";
import type { FieldError } from "../api/types";

type Schema = Record<string, any>;

// deref follows $ref (merging siblings), like the form's resolver, so we can
// walk the schema to find field titles.
function deref(node: Schema | undefined, root: Schema): Schema {
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
function nodeAt(pointer: string, root: Schema): Schema | undefined {
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

// label is a field's schema title, falling back to its raw key.
function label(parent: Schema | undefined, key: string, root: Schema): string {
  const prop = parent?.properties?.[key];
  return (prop && deref(prop, root).title) || key;
}

// breadcrumb turns a JSON Pointer into a friendly path that mirrors the form:
// it prefers view-override titles (e.g. "Gateway"), drops the array index of a
// ui:widget:"single" field (one item, index is noise), and shows other array
// indices as human "#N". Without a schema it falls back to raw keys.
function breadcrumb(pointer: string, root?: Schema, view?: Schema): string {
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

// translate maps the common jsonschema messages to short Russian text.
function translate(msg: string): string {
  let m: RegExpMatchArray | null;
  if ((m = msg.match(/^value must be one of (.+)$/)))
    return `допустимые значения: ${m[1].replace(/"/g, "")}`;
  if ((m = msg.match(/^length must be >= (\d+).*$/))) return `минимальная длина: ${m[1]}`;
  if ((m = msg.match(/^length must be <= (\d+).*$/))) return `максимальная длина: ${m[1]}`;
  if ((m = msg.match(/^minimum:?\s*(.+)$/))) return `минимум: ${m[1]}`;
  if ((m = msg.match(/^maximum:?\s*(.+)$/))) return `максимум: ${m[1]}`;
  if (/does not match pattern/.test(msg)) return "недопустимый формат";
  if (/minItems|minimum .* items/.test(msg)) return "добавьте хотя бы один элемент";
  return msg;
}

// expand turns one field error into display rows. "missing properties" is split
// so each missing field becomes its own row pinned to its full (titled) path.
function expand(d: FieldError, root?: Schema, view?: Schema): { field: string; message: string }[] {
  const base = breadcrumb(d.path, root, view);
  const miss = d.message.match(/^missing properties:\s*(.+)$/);
  if (miss) {
    const parent = root ? nodeAt(d.path, root) : undefined;
    return miss[1]
      .split(",")
      .map((s) => s.replace(/['"\s]/g, ""))
      .filter(Boolean)
      .map((name) => {
        const text = root ? label(parent, name, root) : name;
        return { field: base ? `${base} › ${text}` : text, message: "обязательное поле" };
      });
  }
  return [{ field: base || "значения", message: translate(d.message) }];
}

// FormErrors renders a submission error: a headline plus, when present, a tidy
// per-field breakdown of schema validation failures (field titles from schema).
export function FormErrors({
  message,
  details,
  schema,
  view,
}: {
  message: string;
  details?: FieldError[];
  schema?: Schema;
  view?: Schema;
}) {
  const rows = (details ?? []).flatMap((d) => expand(d, schema, view));
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <div className="flex items-center gap-2 font-medium">
        <IconAlertTriangle size={16} stroke={1.8} className="shrink-0" />
        {rows.length > 0 ? "Проверьте поля формы" : message}
      </div>
      {rows.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {rows.map((r, i) => (
            <li key={i} className="flex flex-wrap gap-x-2">
              <span className="font-medium text-red-700">{r.field}</span>
              <span className="text-red-600">— {r.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
