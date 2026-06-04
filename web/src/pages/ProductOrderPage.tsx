import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import yaml from "js-yaml";
import { useAsync } from "../hooks/useAsync";
import { useTeam } from "../app/TeamContext";
import { Button, Card, ErrorBox, Spinner, TextField } from "../components/ui";
import { SchemaForm, pruneEmpty } from "../form/SchemaForm";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { findProduct } from "../components/icons";

type Values = Record<string, unknown>;

// Order form for a product backed by a static JSON Schema under /schemas/.
// These products are not yet mapped to a Harbor chart, so submission is not
// wired to the backend — the form renders values for review/raw-YAML editing.
export function ProductOrderPage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const { team } = useTeam();
  const product = findProduct(slug);

  // Load the schema (source of truth for validation) plus an optional companion
  // *.ui.json holding presentation views. The "order" view shows one Gateway and
  // hides xroutes; routes are added later from the request card via a PATCH.
  const { data, error, loading } = useAsync(
    async () => {
      if (!product?.schema) return null;
      const schema = await fetch(`/schemas/${product.schema}`).then((r) => r.json());
      const uiName = product.schema.replace(/\.schema\.json$/, ".ui.json");
      const ui = await fetch(`/schemas/${uiName}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      return { schema, ui };
    },
    [product?.schema],
  );
  const schema = data?.schema ?? null;
  const orderView = data?.ui?.views?.order;

  const [serviceName, setServiceName] = useState("");
  const [mode, setMode] = useState<"form" | "raw">("form");
  const [values, setValues] = useState<Values>({});
  const [raw, setRaw] = useState("");

  if (!product) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Неизвестный продукт. <Link to="/requests" className="underline">К списку заказов</Link>.
      </div>
    );
  }
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!schema) return <ErrorBox error={new Error("Схема продукта не найдена")} />;

  function switchMode(next: "form" | "raw") {
    if (next === mode) return;
    if (next === "raw") setRaw(yaml.dump(pruneEmpty(values)));
    else {
      try {
        setValues((yaml.load(raw) as Values) ?? {});
      } catch {
        /* keep form values if YAML is invalid */
      }
    }
    setMode(next);
  }

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: product.label, to: `/products/${slug}` }, { label: "Заказ" }]} />

      <h1 className="text-xl font-semibold text-slate-900">Заказать {product.label}</h1>

      <Card className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Команда" value={team ?? ""} onChange={() => {}} />
        <TextField
          label="Имя сервиса"
          isRequired
          placeholder="my-gateway"
          value={serviceName}
          onChange={setServiceName}
        />
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Values</h2>
          <div className="flex gap-1 rounded-md bg-gray-100 p-0.5 text-xs">
            <button
              onClick={() => switchMode("form")}
              className={`rounded px-2 py-1 ${mode === "form" ? "bg-white shadow" : "text-gray-500"}`}
            >
              Форма
            </button>
            <button
              onClick={() => switchMode("raw")}
              className={`rounded px-2 py-1 ${mode === "raw" ? "bg-white shadow" : "text-gray-500"}`}
            >
              Raw YAML
            </button>
          </div>
        </div>

        {mode === "form" ? (
          <SchemaForm schema={schema} value={values} onChange={setValues} view={orderView} />
        ) : (
          <div className="overflow-hidden rounded-md border border-gray-200">
            <Editor
              height="420px"
              defaultLanguage="yaml"
              value={raw}
              onChange={(v) => setRaw(v ?? "")}
              options={{ minimap: { enabled: false }, fontSize: 13, automaticLayout: true }}
            />
          </div>
        )}
      </Card>

      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        Оформление заказа для «{product.label}» появится, когда продукт будет привязан к чарту.
        Сейчас форма собирает и валидирует values (можно посмотреть результат во вкладке Raw YAML).
      </div>

      <div className="flex gap-2">
        <Button variant="primary" isDisabled>
          Submit order
        </Button>
        <Button variant="secondary" onPress={() => navigate(-1)}>
          Отмена
        </Button>
      </div>
    </div>
  );
}
