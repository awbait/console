import { useMemo } from "react";
import { api } from "@/api/client";
import { qk } from "@/api/queryKeys";
import { useAsync } from "@/hooks/useAsync";
import type { ParsedNamespace } from "./namespace";
import { usesVariables, variableValuesOn } from "./tmpl";

// useNamespaceVars loads the platform variables a namespace template names, as
// the order's stand sees them, so the form can show the namespace the order
// will land in. A template that names none costs no request, and until the list
// arrives the namespace stays unknown rather than shown half-built.
export function useNamespaceVars(ns: ParsedNamespace, standId: string): Record<string, string> | undefined {
  const needed = ns.source === "template" && usesVariables(ns.template ?? "");
  // Under the shared key only when the list is actually read: the key is the
  // admin page's too, and a null written there would empty its table. Sharing
  // it is what lets a page seed the list without a request (the playground).
  const { data } = useAsync(
    () => (needed ? api.listVariables() : Promise.resolve(null)),
    [needed],
    needed ? qk.variables() : undefined,
  );
  return useMemo(() => (data ? variableValuesOn(data, standId) : undefined), [data, standId]);
}
