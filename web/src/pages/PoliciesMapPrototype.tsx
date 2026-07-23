import { IconArrowLeft, IconCopy, IconPlus, IconSitemap, IconWand } from "@tabler/icons-react";
import yaml from "js-yaml";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useToast } from "../app/ToastContext";
import { Button, TextField } from "../components/ui";
import {
  type GraphModel,
  PoliciesGraph,
  type PoliciesGraphHandle,
} from "./policiesMap/PoliciesGraph";
import { manualProvider } from "./policiesMap/topology";
import {
  buildValues,
  DEFAULT_NAMING,
  type NamingTags,
  validateSubmit,
} from "./policiesMap/valuesBuilder";

// The pluggable topology source. Manual mode suggests nothing; later tiers
// (orders data, collector snapshot) return deployed namespaces here.
const provider = manualProvider;

const EMPTY_MODEL: GraphModel = { topology: [], edges: [], orderNs: null };

// PoliciesMapPrototype is the sandbox page: the reusable PoliciesGraph plus a
// side panel with naming tags, the live values.yaml preview and the order
// handoff button.
export function PoliciesMapPrototype() {
  const toast = useToast();
  const graph = useRef<PoliciesGraphHandle>(null);
  const [model, setModel] = useState<GraphModel>(EMPTY_MODEL);
  const [naming, setNaming] = useState<NamingTags>(DEFAULT_NAMING);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    provider.suggestNamespaces().then(setSuggestions).catch(() => setSuggestions([]));
  }, []);

  const { topology, edges, orderNs } = model;

  // values.yaml is rebuilt straight from the edges on every change: the edges
  // are the model, there is no intermediate arrow JSON.
  const valuesYaml = useMemo(() => {
    if (edges.length === 0 || !orderNs) return "";
    // noRefs: with bidirectional links the same selector object lands in the
    // values twice and js-yaml would emit &ref_0/*ref_0 anchors - dump plain
    // copies instead.
    return yaml.dump(buildValues(topology, edges, naming, orderNs), {
      lineWidth: 100,
      sortKeys: false,
      noRefs: true,
    });
  }, [topology, edges, naming, orderNs]);

  // Copy the generated values.yaml. navigator.clipboard needs a secure
  // context, which the dev stand over plain http lacks - fall back to the
  // hidden-textarea trick there.
  const copyValues = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(valuesYaml);
      } else {
        const ta = document.createElement("textarea");
        ta.value = valuesYaml;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      toast.success("values.yaml скопирован.");
    } catch {
      toast.error("Не удалось скопировать в буфер обмена.");
    }
  }, [valuesYaml, toast]);

  const submit = useCallback(() => {
    const errors = validateSubmit(topology, edges, naming, orderNs);
    if (errors.length) {
      toast.error(`Валидация не пройдена: ${errors.join(" ")}`);
      return;
    }
    // No backend in the prototype: simulate the would-be order handoff.
    toast.success("values валиден. Здесь values передадутся в форму заказа policies.");
  }, [topology, edges, naming, orderNs, toast]);

  return (
    <div className="flex h-[calc(100vh-1px)] flex-col">
      <div className="flex items-center gap-4 border-b border-gray-200 bg-surface px-4 py-3">
        <Link
          to="/catalog"
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600"
        >
          <IconArrowLeft size={16} /> Портал
        </Link>
        <h1 className="text-sm font-semibold text-slate-900">
          Карта сетевого взаимодействия (сандбокс)
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <Button onPress={() => graph.current?.loadExample()}>
            <IconWand size={16} /> Пример
          </Button>
          <Button variant="primary" onPress={() => graph.current?.openAddNamespace()}>
            <IconPlus size={16} /> Namespace
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <PoliciesGraph ref={graph} suggestions={suggestions} onModelChange={setModel} />

        <aside className="flex w-[380px] shrink-0 flex-col border-l border-gray-200 bg-surface">
          <div className="grid grid-cols-3 gap-2 border-b border-gray-200 px-3 py-2">
            <TextField
              label="instanceTag"
              value={naming.instanceTag}
              onChange={(v) => setNaming((n) => ({ ...n, instanceTag: v }))}
            />
            <TextField
              label="clusterTag"
              value={naming.clusterTag}
              onChange={(v) => setNaming((n) => ({ ...n, clusterTag: v }))}
            />
            <TextField
              label="projectTag"
              value={naming.projectTag}
              onChange={(v) => setNaming((n) => ({ ...n, projectTag: v }))}
            />
          </div>
          <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2">
            <span className="text-xs font-semibold text-slate-700">values.yaml</span>
            {orderNs ? (
              <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700">
                заказ: {orderNs}
              </span>
            ) : (
              <span className="text-[11px] text-slate-400">ns заказа не выбран</span>
            )}
            <button
              type="button"
              onClick={copyValues}
              disabled={edges.length === 0}
              aria-label="Скопировать values.yaml"
              className="ml-auto flex cursor-pointer items-center gap-1 rounded-md border border-gray-300 bg-surface px-2 py-1 text-xs font-medium text-slate-600 outline-none hover:bg-gray-50 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-default disabled:opacity-40"
            >
              <IconCopy size={14} /> Скопировать
            </button>
          </div>
          {edges.length === 0 || !orderNs ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-app p-6 text-center">
              <IconSitemap size={28} stroke={1.5} className="text-slate-300" />
              <p className="text-xs leading-5 text-slate-400">
                {orderNs ? (
                  <>
                    Пока пусто: соедините порты стрелками,
                    <br />и values.yaml появится здесь.
                  </>
                ) : (
                  <>
                    Выберите namespace заказа:
                    <br />
                    ПКМ по кубику -&gt; «Namespace заказа».
                  </>
                )}
              </p>
            </div>
          ) : (
            <pre className="min-h-0 flex-1 overflow-auto bg-app p-3 font-mono text-xs leading-relaxed text-slate-700">
              {valuesYaml}
            </pre>
          )}
          <div className="border-t border-gray-200 p-3">
            <Button variant="primary" onPress={submit} className="w-full justify-center">
              Заказать
            </Button>
            <p className="mt-2 text-center text-[11px] text-slate-400">
              Кнопка передаст собранный values.yaml в форму заказа сервиса policies.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
