import { useMemo } from "react";
import { api } from "@/api/client";
import { useAsync } from "@/hooks/useAsync";
import type { ParsedNamespace } from "./namespace";
import { usesVariables, variableValuesOn } from "./tmpl";

// useNamespaceVars loads the platform variables a namespace template names, as
// the order's stand sees them, so the form can show the namespace the order
// will land in. A template that names none costs no request, and until the list
// arrives the namespace stays unknown rather than shown half-built.
export function useNamespaceVars(ns: ParsedNamespace, standId: string): Record<string, string> | undefined {
  const needed = ns.source === "template" && usesVariables(ns.template ?? "");
  const { data } = useAsync(
    () => (needed ? api.listVariables() : Promise.resolve(null)),
    [needed],
  );
  return useMemo(() => (data ? variableValuesOn(data, standId) : undefined), [data, standId]);
}
