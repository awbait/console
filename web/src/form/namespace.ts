// Namespace directive (views.order.namespace) resolution, mirrored from the Go
// side (internal/views/namespace.go). It decides where an order's ArgoCD
// destination namespace comes from and whether the order form shows a Namespace
// input. Kept chart-agnostic: the rule lives in the chart's view document.

type Values = Record<string, unknown>;

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
