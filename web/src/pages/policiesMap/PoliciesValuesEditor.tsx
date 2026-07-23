import { IconInfoCircle } from "@tabler/icons-react";
import { useMemo, useRef } from "react";
import { FormErrors } from "../../components/FormErrors";
import type { ValuesEditorProps } from "../../components/products/valuesEditors";
import { type GraphModel, PoliciesGraph } from "./PoliciesGraph";
import { buildPolicies } from "./valuesBuilder";
import { parseValues } from "./valuesParser";

// PoliciesValuesEditor is the "graph" values editor of the policies chart on
// the order form. It parses the current values into a graph once per mount
// (the mode switch remounts it), then owns the model: every edit regenerates
// values.policies while every other section of the values passes through
// untouched. When the values cannot be represented on the graph the editor
// shows the reasons and leaves the values alone.
export function PoliciesValuesEditor({
  values,
  onValues,
  namespace,
  readOnly,
  inputError,
}: ValuesEditorProps) {
  const valuesRef = useRef(values);
  valuesRef.current = values;
  // Parse once per namespace (the graph below is keyed by it): after that the
  // graph owns policies[], and re-parsing every regenerated values would fight
  // it. When the user fills the namespace in the form later, the parse - and
  // the graph - rebuild around it.
  const parsed = useMemo(
    () => (!inputError && namespace ? parseValues(valuesRef.current, namespace) : null),
    [namespace, inputError],
  );

  if (inputError) {
    return (
      <FormErrors
        message={`Невалидный YAML - граф построить нельзя: ${inputError}. Исправьте текст на вкладке Raw YAML (он не изменён).`}
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
  if (parsed && parsed.errors.length > 0) {
    return (
      <div className="flex flex-col gap-2">
        <FormErrors
          message={`Часть values не отображается на графе: ${parsed.errors.join(" ")}`}
        />
        <p className="text-xs text-slate-500">
          Исправьте эти записи в Form или Raw YAML - граф не изменял values.
        </p>
      </div>
    );
  }

  const onModelChange = (m: GraphModel) => {
    if (readOnly) return;
    onValues({
      ...valuesRef.current,
      policies: buildPolicies(m.topology, m.edges, namespace),
    });
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
