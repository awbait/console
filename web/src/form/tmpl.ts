// The template dialect of a view document, mirrored from the Go side
// (internal/views/tmpl.go): a reference in double braces and nothing else -
// "{{.A.B}}" or "{{index .A "b"}}", no conditions, loops, pipelines or
// functions. Only the namespace template is rendered here: the form shows the
// namespace an order will land in while it is being typed, and asking the
// server on every keystroke would lag behind the typing. The server renders the
// same template again on save, and its answer is the one that counts.

type Values = Record<string, unknown>;

const OPEN = "{{";
const CLOSE = "}}";

const DOTTED = /^\.[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/;
const INDEX = /^index\s+(\.[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*)((?:\s+"[^"\\]+")+)$/;
const INDEX_KEY = /"([^"\\]+)"/g;
const OURS = /^[ \t]*(\.|index[ \t]+\.)/;

// parseRef reads the expression between the braces into the path it names, or
// null when it is not a reference of the dialect.
export function parseRef(expr: string): string[] | null {
  if (DOTTED.test(expr)) return expr.slice(1).split(".");
  const m = INDEX.exec(expr);
  if (!m) return null;
  const path = m[1].slice(1).split(".");
  for (const k of m[2].matchAll(INDEX_KEY)) path.push(k[1]);
  return path;
}

// What a namespace template reads besides the values: the order's context and
// the platform variables as the order's stand sees them.
export interface NamespaceContext {
  team?: string;
  serviceName?: string;
  cluster?: string;
  chart?: string;
  vars?: Record<string, string>;
}

// The references a namespace template may use, outside the values. Mirrors the
// in_namespace entries of views.TemplateRefs.
const CONTEXT: Record<string, keyof Omit<NamespaceContext, "vars">> = {
  ".Team": "team",
  ".ServiceName": "serviceName",
  ".Cluster": "cluster",
  ".Chart": "chart",
};

function scalar(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function valueAt(values: Values, path: string[]): string {
  let cur: unknown = values;
  for (const key of path) {
    if (cur == null || typeof cur !== "object" || Array.isArray(cur)) return "";
    cur = (cur as Values)[key];
  }
  return scalar(cur);
}

function resolve(path: string[], values: Values, ctx: NamespaceContext): string {
  if (path[0] === "Values") return path.length > 1 ? valueAt(values, path.slice(1)) : "";
  if (path[0] === "Vars" && path.length === 2) return ctx.vars?.[path[1]] ?? "";
  const key = CONTEXT["." + path.join(".")];
  return key ? (ctx[key] ?? "") : "";
}

// renderNamespaceTemplate renders the template for the form, or returns ""
// when it cannot be rendered yet: a field still empty, a variable not loaded,
// a reference the server would refuse. A partial name ("nbox--ns-app") is never
// shown: the server would not create it either.
export function renderNamespaceTemplate(tmpl: string, values: Values, ctx: NamespaceContext): string {
  let out = "";
  let s = tmpl;
  for (;;) {
    const i = s.indexOf(OPEN);
    if (i < 0) return out + s;
    const rest = s.slice(i + OPEN.length);
    const end = rest.indexOf(CLOSE);
    if (!OURS.test(rest) || end < 0) return "";
    const path = parseRef(rest.slice(0, end).trim());
    if (!path) return "";
    const v = resolve(path, values, ctx);
    if (v === "") return "";
    out += s.slice(0, i) + v;
    s = rest.slice(end + CLOSE.length);
  }
}

// variableValuesOn flattens the variables to name -> value as the stand sees
// them: its own value where it has one, the shared one otherwise. Mirrors
// models.VariableValuesOn.
export function variableValuesOn(
  list: { name: string; value: string; overrides?: { stand_id: string; value: string }[] }[],
  standId: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of list) out[v.name] = v.overrides?.find((o) => o.stand_id === standId)?.value ?? v.value;
  return out;
}

// usesVariables reports whether a template names a platform variable, so the
// form loads the list only when it has a question for it.
export function usesVariables(tmpl: string): boolean {
  let s = tmpl;
  for (;;) {
    const i = s.indexOf(OPEN);
    if (i < 0) return false;
    s = s.slice(i + OPEN.length);
    const end = s.indexOf(CLOSE);
    if (end < 0) return false;
    if (parseRef(s.slice(0, end).trim())?.[0] === "Vars") return true;
    s = s.slice(end + CLOSE.length);
  }
}
