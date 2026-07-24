// Presentational pieces of the order form (OrderPage), extracted so the
// chart-manage preview renders the exact same form a user sees when ordering:
// OrderMetaCard (display name / service name / cluster / namespace + summary)
// and OrderValuesCard (Form/Raw YAML toggle over the schema-driven form).
import Editor from "@monaco-editor/react";
import { Suspense } from "react";
import type { JSONSchema } from "../api/types";
import { useTheme } from "../app/ThemeContext";
import { dnsLabelError, fieldMsg } from "../form/fieldErrors";
import { namespaceError } from "../form/namespace";
import { SchemaForm, type View } from "../form/SchemaForm";
import type { ValuesEditorPlugin } from "./products/valuesEditors";
import { Card, Select, Spinner, TextField } from "./ui";

type Values = Record<string, unknown>;

// OrderMetaCard holds the order's non-values fields. When the order view declares
// an identity field, the service name comes from the form, so the Service name
// input is hidden and the resolved identity is shown in the summary line instead.
export function OrderMetaCard({
  identity,
  displayName,
  onDisplayName,
  serviceName,
  onServiceName,
  cluster,
  onCluster,
  namespace,
  onNamespace,
  hideNamespace = false,
  namespaceHint,
  team,
  version,
  latest = false,
  versions,
  onVersion,
  recommendedVersion,
  identityName,
  showErrors = false,
}: {
  identity?: string;
  displayName: string;
  onDisplayName: (v: string) => void;
  serviceName: string;
  onServiceName: (v: string) => void;
  cluster: string;
  onCluster: (v: string) => void;
  namespace: string;
  onNamespace: (v: string) => void;
  // Hide the Namespace input: the chart sources destination.namespace from its
  // own values field or a fixed constant (view "namespace" directive), so there
  // is nothing for the user to type.
  hideNamespace?: boolean;
  // Resolved destination namespace to show while the input is hidden ("where
  // will this deploy"). Empty - not resolvable yet (form not filled in).
  namespaceHint?: string;
  team?: string;
  version?: string;
  latest?: boolean;
  // Orderable versions (allowlist) and a setter: when more than one is offered a
  // version dropdown is shown; otherwise the version is just printed below.
  versions?: string[];
  onVersion?: (v: string) => void;
  recommendedVersion?: string;
  identityName?: string;
  showErrors?: boolean;
}) {
  const showVersionSelect = !!onVersion && !!versions && versions.length > 1;
  return (
    <Card className="flex flex-col gap-3">
      <TextField
        label="Отображаемое имя"
        description="Произвольное имя для отображения. Можно изменить позже, на развёртывание не влияет."
        placeholder={identity ? "Напр. Production" : "payments-db"}
        value={displayName}
        onChange={onDisplayName}
      />
      {!identity && (
        <TextField
          label="Service name"
          isRequired
          placeholder="payments-db"
          value={serviceName}
          onChange={onServiceName}
          errorText={
            dnsLabelError(serviceName) ??
            (showErrors && !serviceName ? fieldMsg.required : undefined)
          }
        />
      )}
      <TextField
        label="Кластер"
        description="Кластер назначения ArgoCD (destination.name)."
        isRequired
        placeholder="in-cluster"
        value={cluster}
        onChange={onCluster}
        errorText={
          dnsLabelError(cluster) ?? (showErrors && !cluster ? fieldMsg.required : undefined)
        }
      />
      {!hideNamespace ? (
        <TextField
          label="Namespace"
          description="Namespace назначения в кластере (destination.namespace)."
          isRequired
          placeholder="my-namespace"
          value={namespace}
          onChange={onNamespace}
          errorText={
            namespaceError(namespace) ??
            (showErrors && !namespace ? fieldMsg.required : undefined)
          }
        />
      ) : (
        // The input is hidden (the chart names the namespace itself); still show
        // where the deploy will land, so the hidden field is not a surprise.
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-700">Namespace</span>
          <p className="text-sm text-gray-600">
            {namespaceHint ? (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px] text-slate-700">
                {namespaceHint}
              </span>
            ) : (
              <span className="text-gray-500">определится из значений формы</span>
            )}
          </p>
          <span className="text-xs text-gray-500">
            Namespace назначения задаёт сам чарт, вводить его не нужно.
          </span>
        </div>
      )}
      {showVersionSelect && (
        <Select
          label="Версия"
          description="Версия чарта для заказа."
          selectedKey={version ?? null}
          onSelectionChange={(v) => onVersion?.(v)}
          options={(versions ?? []).map((v) => ({
            id: v,
            label: v === recommendedVersion ? `${v} (рекомендуемая)` : v,
          }))}
        />
      )}
      <p className="text-xs text-gray-500">
        Команда <span className="font-medium text-gray-700">{team}</span> · версия{" "}
        <span className="font-medium text-gray-700">{version}</span>
        {latest && " (последняя)"}
        {!showVersionSelect && version === recommendedVersion && recommendedVersion && " (рекомендуемая)"}
        {identity && (
          <>
            {" "}· идентификатор:{" "}
            <span className="font-medium text-gray-700">{identityName || "-"}</span> (из формы)
          </>
        )}
      </p>
    </Card>
  );
}

// OrderValuesCard renders the chart values: a Form/Raw YAML toggle, the
// schema-driven form (the order view projection) or the raw YAML editor. Mode
// switching (which converts between form values and YAML) is owned by the parent
// via onSwitchMode, so the parent keeps a single source of truth for submit.
export function OrderValuesCard({
  schema,
  view,
  values,
  onValues,
  mode,
  onSwitchMode,
  raw,
  onRaw,
  errors,
  showErrors = false,
  lockReadOnly = false,
  lockedPaths,
  plugins = [],
  pluginNamespace = "",
  pluginInputError = null,
  pluginState,
  onPluginState,
}: {
  schema: JSONSchema | null;
  view?: View;
  values: Values;
  onValues: (v: Values) => void;
  mode: string;
  onSwitchMode: (next: string) => void;
  raw: string;
  onRaw: (s: string) => void;
  errors?: Map<string, string>;
  showErrors?: boolean;
  // Lock ui:readOnly fields (set on edit/upgrade of a live order).
  lockReadOnly?: boolean;
  // Always-locked field paths (e.g. the deploy identity on upgrade).
  lockedPaths?: string[];
  // Chart-specific extra editors (e.g. the policies graph); each adds its own
  // toggle button after Form/Raw YAML.
  plugins?: ValuesEditorPlugin[];
  // Order namespace passed through to plugins.
  pluginNamespace?: string;
  // Raw-YAML parse error carried into the plugin (it must show it and keep
  // the values untouched).
  pluginInputError?: string | null;
  // Opaque plugin editor state surviving mode switches (see ValuesEditorProps).
  pluginState?: unknown;
  onPluginState?: (s: unknown) => void;
}) {
  const { theme } = useTheme();
  const monacoTheme = theme === "light" ? "light" : "vs-dark";
  const activePlugin = plugins.find((p) => p.id === mode) ?? null;
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Параметры сервиса</h2>
        <div className="flex gap-1 rounded-md bg-gray-100 p-0.5 text-xs">
          <button
            onClick={() => onSwitchMode("form")}
            className={`rounded px-2 py-1 ${mode === "form" ? "bg-surface shadow" : "text-gray-500"}`}
          >
            Форма
          </button>
          <button
            onClick={() => onSwitchMode("raw")}
            className={`rounded px-2 py-1 ${mode === "raw" ? "bg-surface shadow" : "text-gray-500"}`}
          >
            YAML
          </button>
          {plugins.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onSwitchMode(p.id)}
              className={`flex items-center gap-1 rounded px-2 py-1 ${
                mode === p.id ? "bg-surface shadow" : "text-gray-500"
              }`}
            >
              {p.label}
              {p.badge && (
                <span className="rounded-full bg-brand-100 px-1.5 text-[9px] font-semibold uppercase tracking-wide text-brand-700">
                  {p.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {activePlugin ? (
        <Suspense fallback={<Spinner label="Загрузка редактора…" />}>
          <activePlugin.Component
            values={values}
            onValues={onValues}
            namespace={pluginNamespace}
            inputError={pluginInputError}
            editorState={pluginState}
            onEditorState={onPluginState}
          />
        </Suspense>
      ) : mode === "form" ? (
        schema ? (
          <SchemaForm
            schema={schema}
            value={values}
            onChange={onValues}
            view={view}
            errors={errors}
            showErrors={showErrors}
            lockReadOnly={lockReadOnly}
            lockedPaths={lockedPaths}
          />
        ) : (
          <p className="text-sm text-gray-500">No schema for this version - switch to Raw YAML.</p>
        )
      ) : (
        <div className="overflow-hidden rounded-md border border-gray-200">
          <Editor
            height="320px"
            defaultLanguage="yaml"
            theme={monacoTheme}
            value={raw}
            onChange={(v) => onRaw(v ?? "")}
            options={{ minimap: { enabled: false }, fontSize: 13, automaticLayout: true }}
          />
        </div>
      )}
    </Card>
  );
}
