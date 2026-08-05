import { IconInfoCircle } from "@tabler/icons-react";
import { useMemo, useRef } from "react";
import { FormErrors } from "../../../../components/FormErrors";
import { namespaceError } from "../../../../form/namespace";
import type { ValuesEditorProps } from "../../../orders/valuesEditors";
import { readEntries, writeEntries } from "../../mapping";
import { packEditorState, readEditorState } from "./editorState";
import { type GraphModel, PoliciesGraph, type XY } from "./PoliciesGraph";
import { buildPolicies } from "./valuesBuilder";
import { mergeWithSaved, parseValues } from "./valuesParser";

// PoliciesValuesEditor is the "graph" values editor of the policies chart on
// the order form. On mount it parses the current values and merges the saved
// canvas state over them (values cannot express empty namespaces, unlinked
// workloads, target SAs, extra ports or kinds - editorState carries those
// across mode switches). Afterwards the graph owns the model: every edit
// regenerates values.policies while every other section of the values passes
// through untouched. When the values cannot be represented on the graph the
// editor shows the reasons and leaves the values alone.
export function PoliciesValuesEditor({
  values,
  onValues,
  namespace,
  chartVersion,
  mapping,
  readOnly,
  inputError,
  editorState,
  onEditorState,
}: ValuesEditorProps) {
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const stateRef = useRef(editorState);
  stateRef.current = editorState;
  const versionRef = useRef(chartVersion);
  versionRef.current = chartVersion;
  const mappingRef = useRef(mapping);
  mappingRef.current = mapping;

  // Parse once per namespace (the graph below is keyed by it): after that the
  // graph owns policies[], and re-parsing every regenerated values would fight
  // it. When the user fills the namespace in the form later, the parse - and
  // the graph - rebuild around it.
  const parsed = useMemo(() => {
    if (inputError || !namespace || namespaceError(namespace)) return null;
    const p = parseValues(valuesRef.current, namespace, mappingRef.current);
    if (p.errors.length > 0) return p;
    const saved = readEditorState(stateRef.current, versionRef.current);
    return mergeWithSaved(p, saved && saved.orderNs === namespace ? saved : null);
  }, [namespace, inputError]);

  if (inputError) {
    return (
      <FormErrors
        message={`Невалидный YAML - граф построить нельзя: ${inputError}. Исправьте текст на вкладке YAML (он не изменён).`}
      />
    );
  }
  if (!namespace) {
    return (
      <p className="flex items-center gap-2 rounded-md border border-gray-200 bg-app p-3 text-sm text-slate-500">
        <IconInfoCircle size={16} className="shrink-0" />
        Укажите namespace заказа - граф строится вокруг него.
      </p>
    );
  }
  const nsErr = namespaceError(namespace);
  if (nsErr) {
    return (
      <FormErrors
        message="Namespace указан неверно. Граф появится, как только поле будет исправлено."
      />
    );
  }
  if (parsed && parsed.errors.length > 0) {
    return (
      <div className="flex flex-col gap-2">
        <FormErrors message={`Часть values не отображается на графе: ${parsed.errors.join(" ")}`} />
        <p className="text-xs text-slate-500">
          Исправьте эти записи в режиме «Форма» или «YAML» - граф не изменял values.
        </p>
      </div>
    );
  }

  const onModelChange = (m: GraphModel & { positions: Record<string, XY> }) => {
    // The canvas extras are worth keeping even in readOnly (harmless), but
    // values must never change there.
    onEditorState?.(
      packEditorState(
        { orderNs: namespace, topology: m.topology, positions: m.positions },
        chartVersion,
      ),
    );
    if (readOnly) return;
    // The current values are also the previous generation: passing their
    // policies[] back in keeps entry names and any key the graph does not know
    // (a newer chart, another editing mode) instead of rewriting the section.
    onValues(
      writeEntries(
        valuesRef.current,
        mapping.entries,
        buildPolicies(
          m.topology,
          m.edges,
          namespace,
          mapping,
          readEntries(valuesRef.current, mapping.entries),
        ),
      ),
    );
  };

  return (
    <div className="h-[480px] overflow-hidden rounded-md border border-gray-200">
      <PoliciesGraph
        key={namespace}
        initial={
          parsed
            ? {
                topology: parsed.topology,
                edges: parsed.edges,
                orderNs: namespace,
                positions: parsed.positions,
              }
            : undefined
        }
        lockedOrderNs={namespace}
        readOnly={readOnly}
        onModelChange={onModelChange}
      />
    </div>
  );
}
