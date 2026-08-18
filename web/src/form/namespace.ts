// Namespace directive (views.order.namespace) resolution, mirrored from the Go
// side (internal/views/namespace.go). It decides where an order's ArgoCD
// destination namespace comes from and whether the order form shows a Namespace
// input. Kept chart-agnostic: the rule lives in the chart's view document.

import {
  dnsLabelError,
  dnsLabelRequirements,
  type FieldKind,
  type FieldRequirement,
} from "./fieldErrors";

type Values = Record<string, unknown>;

// The letter rule in both forms, kept together so the complaint and the
// requirement cannot drift: the error tells the reader what to do, the hint
// names what the field takes.
const NS_LETTER_MSG = "Добавьте хотя бы одну букву.";
const NS_LETTER_HINT = "Хотя бы одна буква.";

// Kubernetes namespace name: an RFC 1123 DNS label of at most 63 characters.
// The backend additionally rejects purely numeric namespaces (validNamespace
// in internal/provisioning/service.go) - mirror that here.
export function namespaceError(ns: string): string | null {
  const e = dnsLabelError(ns);
  if (e) return e;
  if (ns && /^[0-9]+$/.test(ns)) return NS_LETTER_MSG;
  return null;
}

// namespaceRequirements is what the Namespace field accepts, for the hint the
// form ticks off while it is typed into. The check is the backend's - a name of
// nothing but digits is refused - so "1-2" passes it, which the wording rounds
// off rather than complicating.
export function namespaceRequirements(): FieldRequirement[] {
  return [...dnsLabelRequirements(), { text: NS_LETTER_HINT, met: (v) => !/^[0-9]+$/.test(v) }];
}

// The namespace as a field kind, for every input that asks for one: the order
// card, the map's "add namespace", the values importer. It lives here rather
// than in the fieldKind catalogue because the extra rule is this module's.
export const namespaceKind: FieldKind = {
  requirements: namespaceRequirements(),
  error: namespaceError,
};

export type NamespaceSource = "field" | "values" | "fixed";

// The object form of the directive. The legacy string form ("/ptr") is a mirror
// (the order namespace is copied into that values field) and keeps source=field.
export interface NamespaceRule {
  source?: NamespaceSource;
  pointer?: string; // source=values: values field holding the namespace
  value?: string; // source=fixed: the literal namespace
  hideOrderField?: boolean;
}

export interface ParsedNamespace {
  source: NamespaceSource;
  pointer?: string;
  value?: string;
  // Whether the order form hides its Namespace input (source=values/fixed).
  hideField: boolean;
  // Legacy string form: mirror the order namespace into this values pointer.
  mirrorPointer?: string;
}

// readObjectPointer resolves an object-only JSON Pointer to a string (numeric
// segments are treated as plain keys, matching the Go setPointer semantics).
function readObjectPointer(obj: unknown, pointer: string): string {
  let cur: unknown = obj;
  for (const part of pointer.split("/").filter(Boolean)) {
    if (cur == null || typeof cur !== "object") return "";
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur == null ? "" : String(cur);
}

// parseNamespaceDirective normalizes views.order.namespace (string | object |
// undefined) into a ParsedNamespace. Unknown/absent -> source=field, shown.
export function parseNamespaceDirective(ns: unknown): ParsedNamespace {
  if (typeof ns === "string") {
    return ns.startsWith("/")
      ? { source: "field", hideField: false, mirrorPointer: ns }
      : { source: "field", hideField: false };
  }
  if (ns && typeof ns === "object") {
    const o = ns as NamespaceRule;
    const source: NamespaceSource =
      o.source === "values" || o.source === "fixed" ? o.source : "field";
    return {
      source,
      pointer: typeof o.pointer === "string" ? o.pointer : undefined,
      value: typeof o.value === "string" ? o.value : undefined,
      // Only non-field sources can hide the field (field has nothing else to source from).
      hideField: source !== "field" && o.hideOrderField === true,
    };
  }
  return { source: "field", hideField: false };
}

// resolveDestNamespace computes the destination namespace to submit: from the
// values field (source=values), a constant (source=fixed), or the form input
// (source=field). Empty falls back to the caller's default (service_name).
export function resolveDestNamespace(
  parsed: ParsedNamespace,
  orderInput: string,
  values: Values,
): string {
  if (parsed.source === "values" && parsed.pointer) return readObjectPointer(values, parsed.pointer);
  if (parsed.source === "fixed") return parsed.value ?? "";
  return orderInput;
}
