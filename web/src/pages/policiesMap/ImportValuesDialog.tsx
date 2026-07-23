import yaml from "js-yaml";
import { useEffect, useState } from "react";
import { FormErrors } from "../../components/FormErrors";
import { Button, TextField } from "../../components/ui";
import { MapDialog } from "./TopologyDialogs";
import { DNS_NAME_RE } from "./topology";
import { type ParsedGraph, parseValues } from "./valuesParser";

export interface ImportedValues {
  parsed: ParsedGraph;
  orderNs: string;
  // Raw naming section of the pasted values (validated by the caller).
  naming: unknown;
  // The values carried netpol/authzpol sections the sandbox cannot represent.
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
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onLoad: (r: ImportedValues) => void;
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
    if (!DNS_NAME_RE.test(n)) {
      errors.push("Namespace заказа должен быть в DNS-формате.");
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
    const parsed = parseValues(obj, n);
    if (parsed.errors.length > 0) {
      setErrs(parsed.errors);
      return;
    }
    onLoad({
      parsed,
      orderNs: n,
      naming: obj.naming,
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
            placeholder={"naming:\n  instanceTag: ru1\npolicies:\n  - name: core\n    ..."}
            className="rounded-md border border-gray-300 bg-surface p-2 font-mono text-xs leading-relaxed outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </label>
        <p className="text-xs text-slate-500">
          Текущий холст будет заменён разобранным графом.
        </p>
        {errs.length > 0 && <FormErrors message={errs.join(" ")} />}
        <div className="flex justify-end gap-2 border-t border-gray-200 pt-3">
          <Button onPress={() => onOpenChange(false)}>Отмена</Button>
          <Button variant="primary" onPress={submit}>
            Загрузить
          </Button>
        </div>
      </div>
    </MapDialog>
  );
}
