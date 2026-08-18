import yaml from "js-yaml";
import { useEffect, useState } from "react";
import { FormErrors } from "@/components/FormErrors";
import { Button, TextField } from "@/components/ui";
import { fieldMsg, withField } from "@/form/fieldErrors";
import { namespaceError, namespaceKind } from "@/form/namespace";
import { type GraphMapping, readEntries } from "@/features/graph/mapping";
import { MapDialog } from "./TopologyDialogs";
import { type ParsedGraph, parseValues } from "./valuesParser";

export interface ImportedValues {
  parsed: ParsedGraph;
  orderNs: string;
  // Raw identity section of the pasted values (validated by the caller).
  identity: unknown;
  // Raw policies section as pasted. Kept so that ordering from the map writes
  // back into these entries instead of regenerating them: names and keys the
  // graph does not know survive the round trip.
  policies: unknown;
  // The values carried netpol/authzpol sections the map cannot represent.
  hasOtherSections: boolean;
}

// ImportValuesDialog parses a pasted policies values.yaml back into a graph.
// The values do not record the release namespace, so the user names the order
// namespace explicitly; anything the graph cannot represent blocks the import
// with the reasons listed.
export function ImportValuesDialog({
  isOpen,
  onOpenChange,
  onLoad,
  mapping,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onLoad: (r: ImportedValues) => void;
  mapping: GraphMapping;
}) {
  const [ns, setNs] = useState("");
  const [text, setText] = useState("");
  const [errs, setErrs] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) setErrs([]);
  }, [isOpen]);

  function submit() {
    const errors: string[] = [];
    const n = ns.trim();
    // A malformed namespace is the field's own complaint, shown under it; the
    // banner only reports it being missing altogether.
    if (!n) {
      errors.push(withField("Namespace заказа", fieldMsg.required));
    }
    let obj: Record<string, unknown> | null = null;
    try {
      const loaded = yaml.load(text);
      if (loaded == null) errors.push("Пустой YAML.");
      else if (typeof loaded !== "object" || Array.isArray(loaded))
        errors.push("YAML должен быть объектом values.");
      else obj = loaded as Record<string, unknown>;
    } catch (e) {
      errors.push(`YAML не парсится: ${(e as Error).message}`);
    }
    if (errors.length > 0 || !obj) {
      setErrs(errors);
      return;
    }
    const parsed = parseValues(obj, n, mapping);
    if (parsed.errors.length > 0) {
      setErrs(parsed.errors);
      return;
    }
    onLoad({
      parsed,
      orderNs: n,
      identity: obj.identity,
      policies: readEntries(obj, mapping.entries),
      hasOtherSections: !!(obj.netpol || obj.authzpol),
    });
    onOpenChange(false);
  }

  return (
    <MapDialog isOpen={isOpen} onOpenChange={onOpenChange} title="Вставить values">
      <div className="flex flex-col gap-3">
        <TextField
          label="Namespace заказа"
          value={ns}
          onChange={setNs}
          isRequired
          placeholder="team-app"
          kind={namespaceKind}
          description="Values его не хранят: это namespace, куда ставился бы заказ policies."
        />
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-700">
            values.yaml <span className="text-red-500">*</span>
          </span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            spellCheck={false}
            placeholder={"identity:\n  instance: pr\npolicies:\n  - name: core\n    ..."}
            className="rounded-md border border-gray-300 bg-surface p-2 font-mono text-xs leading-relaxed outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </label>
        <p className="text-xs text-slate-500">
          Текущий холст будет заменён разобранным графом.
        </p>
        {errs.length > 0 && <FormErrors message={errs.join(" ")} />}
        <div className="flex justify-end gap-2 border-t border-gray-200 pt-3">
          <Button onPress={() => onOpenChange(false)}>Отмена</Button>
          <Button variant="primary" isDisabled={!!namespaceError(ns.trim())} onPress={submit}>
            Загрузить
          </Button>
        </div>
      </div>
    </MapDialog>
  );
}
