import yaml from "js-yaml";
import { useEffect, useMemo, useRef, useState } from "react";
import { TabList, TabPanel, Tabs } from "react-aria-components";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, HttpError } from "../../api/client";
import type { ChangelogEntry, FieldError, OrderRequest, ViewDocument } from "../../api/types";
import { chartLabel, findCatalogChart, useCatalog } from "../../app/CatalogContext";
import { useTeam } from "../../app/TeamContext";
import { useUser } from "../../auth/UserContext";
import { Breadcrumbs } from "../../components/Breadcrumbs";
import { FormErrors } from "../../components/FormErrors";
import { NotFound } from "../../components/NotFound";
import {
  GenericInfoActions,
  GenericListTab,
  type PersistValues,
} from "../../components/products/GenericProductTabs";
import { actionViews, productTabs } from "../../components/products/genericView";
import { Button, Card, ErrorBox, Loading } from "../../components/ui";
import { namespaceError, parseNamespaceDirective, resolveDestNamespace } from "../../form/namespace";
import { collectErrors, pruneEmpty } from "../../form/SchemaForm";
import { useAsync } from "../../hooks/useAsync";
import { isNewer, upgradeTargets, upgradeTargetsFromAllowlist } from "../../lib/semver";
import { OrderMetaCard, OrderValuesCard } from "./OrderFormParts";
import { DetailTab } from "./requestDetailParts";
import { valuesEditorFor } from "./valuesEditors";

type Values = Record<string, unknown>;

// Shown when a view sources the deploy identity from the values but the field
// is still empty - e.g. the policies graph has no links yet, so there is no
// first policy to take the name from. Without this the empty name reaches the
// backend and comes back as a bare "service_name must be a valid Kubernetes name".
const IDENTITY_MISSING = "Не удалось определить имя сервиса. Заполните данные заказа, из которых оно берётся.";

// readPointer resolves a JSON Pointer (e.g. "/gateways/0/name") to a string.
// Used to source the deploy identity (service_name) from a values field that a
// view declares via "identity" - so the backend stays chart-agnostic.
function readPointer(obj: unknown, pointer: string): string {
  let cur: unknown = obj;
  for (const part of pointer.split("/").filter(Boolean)) {
    if (cur == null || typeof cur !== "object") return "";
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur == null ? "" : String(cur);
}

// writePointer returns a copy of obj with value set at an object JSON Pointer
// (e.g. "/namespace/namespaceName"), creating intermediate objects. Used to
// mirror the order's destination namespace into the values field a view binds
// via "namespace" - matching the backend, which stamps the same field. Numeric
// segments are not addressed (object fields only, like the backend setPointer).
function writePointer(obj: Values, pointer: string, value: string): Values {
  const parts = pointer.split("/").filter(Boolean);
  if (parts.length === 0) return obj;
  const root: Values = { ...obj };
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]];
    const clone: Record<string, unknown> =
      next != null && typeof next === "object" && !Array.isArray(next)
        ? { ...(next as Record<string, unknown>) }
        : {};
    cur[parts[i]] = clone;
    cur = clone;
  }
  cur[parts[parts.length - 1]] = value;
  return root;
}

// OrderPage drives ordering a new service (/catalog/:project/:name/order),
// editing an existing DRAFT (/requests/:id/edit), and upgrading a live order to
// a newer chart version (/requests/:id/upgrade?to=X - the upgrade flag). Upgrade
// reuses the form at the target version (prefilled from the order) and opens an
// update MR; identity/cluster/namespace are immutable once deployed.
export function OrderPage({ upgrade = false }: { upgrade?: boolean }) {
  const { project: pParam = "", name: nParam = "", id } = useParams();
  const [searchParams] = useSearchParams();
  // Upgrade target version from ?to= (the approved version); fallback is the
  // chart's latest version.
  const upgradeToParam = searchParams.get("to") ?? "";
  const editing = !!id;
  const navigate = useNavigate();
  const { user } = useUser();
  // Team is chosen globally (topbar); the order form doesn't ask for it.
  const { team: activeTeam } = useTeam();
  const { charts, loading: catalogLoading } = useCatalog();

  // In edit mode, load the draft we're continuing. Its chart coordinates and
  // pinned version drive the rest of the page.
  const { data: existing, error: existingErr, loading: existingLoading } = useAsync(
    (signal) => (id ? api.getRequest(id, signal) : Promise.resolve(null)),
    [id],
  );
  const draft = existing?.request ?? null;

  const project = editing ? draft?.chart_project ?? "" : pParam;
  const name = editing ? draft?.chart_name ?? "" : nParam;
  // Friendly product label (e.g. "Ingress Gateway") for the title and the
  // pre-filled display name; derived from the chart name.
  const label = name ? chartLabel(name) : "";

  const { data: chart, error: chartErr, loading: chartLoading } = useAsync(
    (signal) => (project && name ? api.getChart(project, name, signal) : Promise.resolve(null)),
    [project, name],
  );

  const [serviceName, setServiceName] = useState("");
  // Pre-fill the display name with the product's friendly label (e.g. "Ingress
  // Gateway"); user can edit or clear it (empty falls back to service_name).
  // In edit mode it's hydrated from the draft below.
  const [displayName, setDisplayName] = useState(() => (id ? "" : nParam ? chartLabel(nParam) : ""));
  // ArgoCD destination: cluster (default in-cluster) + target namespace.
  const [cluster, setCluster] = useState("in-cluster");
  const [namespace, setNamespace] = useState("");
  // New-order chart version: defaults to the recommended (or highest orderable)
  // version once the catalog loads; the user can switch it (initialized below).
  const [selectedVersion, setSelectedVersion] = useState("");
  const [mode, setMode] = useState<string>("form");
  const [values, setValues] = useState<Values>({});
  const [raw, setRaw] = useState("");
  // Raw-YAML parse error carried into a values-editor plugin (the plugin shows
  // it instead of a graph and leaves the user's YAML untouched).
  const [pluginInputError, setPluginInputError] = useState<string | null>(null);
  // Opaque plugin editor state (e.g. the policies graph topology extras). A ref
  // is enough while the page lives - only the plugin reads it, on mount - but it
  // also travels to the backend with every save, so what the canvas holds beyond
  // the values (unlinked workloads, their SA and ports, empty namespaces, node
  // positions) is still there when the draft is reopened.
  const pluginStateRef = useRef<unknown>(null);
  const [submitErr, setSubmitErr] = useState<{ message: string; details?: FieldError[] } | null>(null);
  const [busy, setBusy] = useState<null | "draft" | "submit">(null);
  // Reveal all client-side validation errors (set on a submit attempt); before
  // that, a field's error shows only once it's been touched.
  const [showErrors, setShowErrors] = useState(false);

  // Upgrade: target version strictly from ?to= (no fallback to latest, else one
  // could "upgrade" to an arbitrary version). Draft: the pinned version.
  // New order: the chart's latest version.
  const targetVersion = upgrade ? upgradeToParam : "";
  // Publication overlay: the allowlist of orderable versions + the recommended
  // default (multi-version publications). Empty for legacy single-view charts.
  const pub = findCatalogChart(charts, project, name)?.publication;
  const orderableVersions = pub?.orderable_versions ?? [];
  const recommendedVersion = pub?.recommended_version ?? "";
  // Allowed upgrade versions for this order (newer than current). From the
  // orderable allowlist when available, else the legacy approved-version
  // heuristic. We validate ?to= against them so the form can't open on a
  // missing/disallowed version.
  const allowedUpgrades = !upgrade
    ? []
    : orderableVersions.length > 0
      ? upgradeTargetsFromAllowlist(orderableVersions, draft?.chart_version ?? "")
      : upgradeTargets(chart?.versions ?? [], draft?.chart_version ?? "", pub?.approved_view_version);
  const effectiveVersion = upgrade
    ? targetVersion || null
    : editing
      ? draft?.chart_version ?? null
      : selectedVersion || null;

  // Initialize the new-order version once the catalog/publication is known:
  // recommended, else the highest orderable, else the chart's latest version.
  useEffect(() => {
    if (editing || upgrade || selectedVersion) return;
    const def = recommendedVersion || orderableVersions[0] || chart?.latest_version || "";
    if (def) setSelectedVersion(def);
  }, [editing, upgrade, selectedVersion, recommendedVersion, orderableVersions, chart?.latest_version]);

  // Upgrade: the chart's CHANGELOG between the order's current version and the
  // target, so the changes are visible.
  const { data: changelog } = useAsync(
    async (signal) => {
      if (!upgrade || !project || !name) return [] as ChangelogEntry[];
      const all = await api
        .getAggregatedChangelog(project, name, 20, signal)
        .catch(() => [] as ChangelogEntry[]);
      const from = draft?.chart_version ?? "";
      return all.filter((e) => isNewer(e.version, from) && !isNewer(e.version, targetVersion));
    },
    [upgrade, project, name, draft?.chart_version, targetVersion],
  );

  // Load the schema (from the chart, via the API) plus the chart's approved
  // view document (from its publication). The "order" view curates the form
  // (e.g. one Gateway, hide xroutes); the schema stays the single source of
  // truth for validation.
  const { data: form } = useAsync(
    async (signal) => {
      if (!project || !name || !effectiveVersion) return null;
      const schema = await api.getSchema(project, name, effectiveVersion, signal);
      // Request the view for the selected version only when it is an orderable
      // version; otherwise (legacy charts) fall back to the default active view.
      const viewVersion = orderableVersions.includes(effectiveVersion) ? effectiveVersion : undefined;
      const ui = await api.getChartView(project, name, viewVersion, signal).catch(() => null);
      return { schema, doc: ui, view: ui?.views?.order };
    },
    [project, name, effectiveVersion, orderableVersions.join(",")],
  );
  const schema = form?.schema ?? null;
  const orderView = form?.view;
  const viewDoc = form?.doc ?? null;
  // A view may declare which values field supplies the deploy identity
  // (service_name). When set, we source the name from the form instead of a
  // separate "Service name" input - e.g. the gateway's own name field.
  const identity: string | undefined = orderView?.identity;
  // The namespace directive decides where destination.namespace comes from and
  // whether the order form shows a Namespace input. Legacy string form ("/ptr")
  // is a mirror: the Namespace input is copied into that (hidden) values field.
  // Object form can source it from a values field or a fixed constant and hide
  // the form field entirely. Mirrors internal/views/namespace.go.
  const ns = useMemo(
    () => parseNamespaceDirective((orderView as { namespace?: unknown } | undefined)?.namespace),
    [orderView],
  );
  // Values with the legacy mirror applied - used for validation, identity and
  // submission so the bound (hidden) field is populated from the Namespace input.
  const effectiveValues = useMemo(
    () => (ns.mirrorPointer && namespace ? writePointer(values, ns.mirrorPointer, namespace) : values),
    [values, ns.mirrorPointer, namespace],
  );
  const identityName = identity ? readPointer(effectiveValues, identity) : "";

  // Client-side validation of the form values against the schema (required /
  // pattern / minLength / minItems), honoring the order view. Recomputed live so
  // red highlights clear as the user fixes fields. Empty in raw mode.
  const clientErrors = useMemo(
    () => (mode === "form" && schema ? collectErrors(schema, effectiveValues, orderView) : new Map<string, string>()),
    [mode, schema, effectiveValues, orderView],
  );

  // A save error describes the order as it was sent, so any later edit makes it
  // stale: clear it on the next change instead of leaving it on screen until the
  // user saves again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the deps are the edits to react to, not values the body reads
  useEffect(() => {
    setSubmitErr(null);
  }, [values, raw, serviceName, namespace, cluster, mode]);

  // Hydrate the form from the draft once (edit mode only).
  const hydrated = useRef(false);
  useEffect(() => {
    if (!editing || hydrated.current || !draft) return;
    setServiceName(draft.service_name);
    setDisplayName(draft.display_name);
    if (draft.cluster) setCluster(draft.cluster);
    if (draft.namespace) setNamespace(draft.namespace);
    try {
      setValues((yaml.load(draft.values_yaml) as Values) ?? {});
    } catch {
      setValues({});
    }
    // The canvas extras the values cannot express; the plugin reads them on mount.
    pluginStateRef.current = draft.editor_state ?? null;
    hydrated.current = true;
  }, [editing, draft]);

  // The extra values editor this chart version turns on, straight from its view
  // document: a version with no "graph" block simply has no third tab.
  const editor = useMemo(() => valuesEditorFor(viewDoc), [viewDoc]);

  // The editor can disappear from under the user: on a new order the version
  // select can move to a version that does not declare one. Land on the form
  // instead of leaving the card in a mode that no longer exists.
  useEffect(() => {
    if (mode === "form" || mode === "raw") return;
    if (editor?.plugin.id === mode) return;
    setPluginInputError(null);
    setMode("form");
  }, [editor, mode]);

  if (editing && existingLoading) return <Loading label="Загружаем заказ" />;
  if (editing && existingErr) return <ErrorBox error={existingErr} />;
  if (editing && !upgrade && draft && draft.status !== "DRAFT") {
    // Only drafts are editable here; live orders bounce to the read-only detail
    // page (the upgrade flow is the one exception - it edits a live order).
    // Use <Navigate> rather than calling navigate() during render (which warns in
    // React 19/StrictMode and can double-navigate).
    return <Navigate to={`/requests/${draft.id}`} replace />;
  }
  if (chartLoading) return <Loading label="Готовим форму заказа" />;
  if (chartErr) return <ErrorBox error={chartErr} />;
  if (!chart) return null;

  // Upgrade guard: wait for the catalog (source of allowed versions), then check
  // ?to=. A disallowed/missing target version won't open the upgrade form.
  if (upgrade) {
    if (catalogLoading) return <Loading label="Готовим форму заказа" />;
    if (!targetVersion || !allowedUpgrades.includes(targetVersion)) {
      return (
        <NotFound
          title="Обновление недоступно"
          message="Этой версии для обновления не существует или она не разрешена."
          backTo={id ? `/requests/${id}` : "/requests"}
          backLabel="К заказу"
        />
      );
    }
  }

  if (!user || (user.teams?.length ?? 0) === 0) {
    return (
      <Card>
        <p className="text-sm text-gray-600">
          You need to be a member of a team (group <code>team-*</code>) to order services.
        </p>
      </Card>
    );
  }

  function switchMode(next: string) {
    if (next === mode) return;
    let parseError: string | null = null;
    if (mode === "raw") {
      // Leaving raw: adopt the YAML into the shared values. Invalid YAML keeps
      // the previous values (the raw text itself is preserved either way); a
      // plugin mode surfaces the error explicitly instead of showing a graph
      // built from stale values.
      try {
        setValues((yaml.load(raw) as Values) ?? {});
      } catch (e) {
        parseError = (e as Error).message;
      }
    }
    if (next === "raw") {
      setRaw(yaml.dump(pruneEmpty(values)));
    }
    setPluginInputError(next !== "form" && next !== "raw" ? parseError : null);
    setMode(next);
  }

  // collectValues resolves the values + deploy identity from the active editor
  // (form or raw YAML); returns null and sets an error when invalid.
  function collectValues(): { values: Values; svcName: string; destNamespace: string } | null {
    let finalValues: Values = {};
    try {
      finalValues = mode === "raw" ? ((yaml.load(raw) as Values) ?? {}) : pruneEmpty(values);
    } catch (e) {
      setSubmitErr({ message: "Невалидный YAML: " + (e as Error).message });
      return null;
    }
    // Legacy mirror: copy the Namespace input into the bound (hidden) field so the
    // sent values match what the backend stamps; covers raw mode too.
    if (ns.mirrorPointer && namespace) finalValues = writePointer(finalValues, ns.mirrorPointer, namespace);
    const svcName = identity ? readPointer(finalValues, identity) : serviceName;
    // Destination namespace: the form input (source=field), a values field
    // (source=values), or a fixed constant. The backend recomputes the same way.
    const destNamespace = resolveDestNamespace(ns, namespace, finalValues);
    return { values: finalValues, svcName, destNamespace };
  }

  // editorState is what the visual editor holds beyond the values. undefined
  // means "send nothing", which leaves the stored state untouched - the plain
  // form and the YAML editor must not wipe what the graph saved.
  function editorState(): unknown {
    return pluginStateRef.current ?? undefined;
  }

  // sentName is the deploy identity to send with a save. A chart whose view
  // sources it from the values (the policies graph names the order after its
  // first policy) keeps the name it was created with: editing values must not
  // rename the order behind the user's back. It renamed silently before, and
  // since the name is unique per team/chart/cluster, two orders built from
  // similar graphs collided on a name neither user ever typed. Charts with a
  // "Service name" input keep sending it - there the user renames on purpose.
  function sentName(svcName: string): string | undefined {
    if (editing && identity) return undefined;
    return svcName || undefined;
  }

  function fail(e: unknown) {
    if (e instanceof HttpError) {
      // An open MR blocks the change: explain it in Russian instead of the bare
      // English domain string. The order page itself links to the MR.
      const message =
        e.code === "open_mr"
          ? `Уже открыт запрос на слияние${e.mrIid ? ` #${e.mrIid}` : ""} для этого сервиса. Дождитесь его обработки или закройте его, прежде чем вносить новые изменения.`
          : e.message;
      setSubmitErr({ message, details: e.details });
    } else setSubmitErr({ message: (e as Error).message });
  }

  // saveDraft persists the in-progress order without opening an MR.
  async function saveDraft() {
    setSubmitErr(null);
    const c = collectValues();
    if (!c) return;
    // A new order carries its name from the start; editing keeps the saved one
    // (the name is sent only when resolved), so the guard is create-only.
    if (!editing && !c.svcName) {
      setShowErrors(true);
      setSubmitErr({ message: identity ? IDENTITY_MISSING : "Укажите имя сервиса." });
      return;
    }
    setBusy("draft");
    try {
      if (editing) {
        await api.updateRequest(id!, {
          service_name: sentName(c.svcName),
          display_name: displayName || undefined,
          cluster: cluster || undefined,
          namespace: c.destNamespace || undefined,
          values: c.values,
          editor_state: editorState(),
        });
      } else {
        await api.createRequest({
          chart: `${project}/${name}`,
          version: effectiveVersion!,
          team: activeTeam!,
          service_name: c.svcName,
          display_name: displayName || undefined,
          cluster: cluster || undefined,
          namespace: c.destNamespace || undefined,
          values: c.values,
          editor_state: editorState(),
          draft: true,
        });
      }
      // Back to the product page (its orders list), where the new draft shows on top.
      navigate(project && name ? `/products/${project}/${name}` : "/requests");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  // submit finalises the order: it opens the create MR. For a draft we persist
  // the latest edits first, then submit.
  async function submit() {
    setSubmitErr(null);
    // Client-side validation first: highlight every invalid field in red and stop.
    if (clientErrors.size > 0) {
      setShowErrors(true);
      setSubmitErr({ message: "Заполните обязательные поля, отмеченные красным." });
      return;
    }
    const c = collectValues();
    if (!c) return;
    // Only block when the name is actually needed: an existing draft keeps the
    // one it already has and does not send a new one.
    if (!c.svcName && !(editing && identity)) {
      setShowErrors(true);
      setSubmitErr({ message: identity ? IDENTITY_MISSING : "Укажите имя сервиса." });
      return;
    }
    if (!cluster || !c.destNamespace) {
      setShowErrors(true);
      setSubmitErr({
        message: ns.hideField
          ? "Не удалось определить namespace: заполните поле, из которого он берётся."
          : "Укажите кластер и namespace.",
      });
      return;
    }
    const nsErr = namespaceError(c.destNamespace);
    if (nsErr) {
      setShowErrors(true);
      setSubmitErr({ message: `Namespace указан неверно. ${nsErr}` });
      return;
    }
    setBusy("submit");
    try {
      let req;
      if (editing) {
        // Persist the latest edits, then finalise (opens the create MR).
        await api.updateRequest(id!, {
          service_name: sentName(c.svcName),
          display_name: displayName || undefined,
          cluster,
          namespace: c.destNamespace,
          values: c.values,
          editor_state: editorState(),
        });
        req = await api.submitRequest(id!);
      } else {
        // Direct order: create and open the MR in one shot.
        req = await api.createRequest({
          chart: `${project}/${name}`,
          version: effectiveVersion!,
          team: activeTeam!,
          service_name: c.svcName,
          display_name: displayName || undefined,
          cluster,
          namespace: c.destNamespace,
          values: c.values,
          editor_state: editorState(),
        });
      }
      navigate(`/requests/${req.id}`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  // doUpgrade upgrades a live order to the target version: validates the values
  // against the new schema and opens an update MR (api.updateRequest with the new
  // version). Service name/cluster/namespace are immutable - we send only the
  // version and values.
  async function doUpgrade() {
    setSubmitErr(null);
    if (clientErrors.size > 0) {
      setShowErrors(true);
      setSubmitErr({ message: "Заполните обязательные поля, отмеченные красным." });
      return;
    }
    const c = collectValues();
    if (!c) return;
    setBusy("submit");
    try {
      await api.updateRequest(id!, { version: targetVersion, values: c.values });
      navigate(`/requests/${id}`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  const submitting = busy !== null;

  return (
    <div className="flex flex-col gap-4 pb-8">
      <Breadcrumbs
        items={[
          {
            label: label || `${chart.project}/${chart.name}`,
            to: `/products/${project}/${name}`,
          },
          ...(editing
            ? [
                { label: draft?.service_name || "черновик", to: `/requests/${id}` },
                { label: upgrade ? "Обновление" : "Редактирование" },
              ]
            : [{ label: "Новый заказ" }]),
        ]}
      />
      <h1 className="text-xl font-semibold">
        {upgrade ? "Обновление: " : editing ? "Черновик: " : "Заказ "}
        {label || `${chart.project}/${chart.name}`}
        {upgrade && (
          <span className="text-gray-400">
            {" "}
            {draft?.chart_version} → {targetVersion}
          </span>
        )}
      </h1>

      {upgrade ? (
        <Card className="flex flex-col gap-3">
          <p className="text-sm text-gray-600">
            Сервис <span className="font-medium text-gray-800">{draft?.service_name}</span> · команда{" "}
            <span className="font-medium text-gray-800">{draft?.team}</span> · кластер{" "}
            <span className="font-medium text-gray-800">{draft?.cluster}</span> · namespace{" "}
            <span className="font-medium text-gray-800">{draft?.namespace}</span>
          </p>
          <p className="text-sm text-gray-600">
            Версия <span className="font-medium text-gray-800">{draft?.chart_version}</span> →{" "}
            <span className="font-medium text-brand-700">{targetVersion}</span>. Идентификатор,
            кластер и namespace при обновлении не меняются - правятся только значения под новую схему.
          </p>
          {changelog && changelog.length > 0 && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
              <p className="mb-1.5 font-semibold text-slate-700">Что изменилось в чарте</p>
              <div className="flex flex-col gap-2">
                {changelog.map((e) => (
                  <div key={e.version}>
                    <p className="font-medium text-slate-700">
                      {e.version}
                      {e.date && <span className="ml-1.5 font-normal text-slate-400">{e.date}</span>}
                    </p>
                    {(e.sections ?? []).map((s) => (
                      <div key={s.title} className="ml-1 mt-0.5">
                        <span className="uppercase text-slate-400">{s.title}:</span>{" "}
                        <span className="text-slate-600">{s.items.join("; ")}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      ) : (
        <OrderMetaCard
          identity={identity}
          displayName={displayName}
          onDisplayName={setDisplayName}
          serviceName={serviceName}
          onServiceName={setServiceName}
          cluster={cluster}
          onCluster={setCluster}
          namespace={namespace}
          onNamespace={setNamespace}
          hideNamespace={ns.hideField}
          namespaceHint={ns.hideField ? resolveDestNamespace(ns, namespace, effectiveValues) : undefined}
          team={editing ? draft?.team : activeTeam ?? undefined}
          version={effectiveVersion ?? undefined}
          latest={!editing && orderableVersions.length === 0}
          versions={editing ? undefined : orderableVersions}
          onVersion={editing ? undefined : setSelectedVersion}
          recommendedVersion={recommendedVersion}
          identityName={identityName}
          showErrors={showErrors}
        />
      )}

      <OrderValuesCard
        schema={schema}
        view={orderView}
        values={values}
        onValues={setValues}
        mode={mode}
        onSwitchMode={switchMode}
        raw={raw}
        onRaw={setRaw}
        errors={clientErrors}
        showErrors={showErrors}
        lockReadOnly={upgrade}
        lockedPaths={upgrade && identity ? [identity] : undefined}
        editor={editor}
        pluginNamespace={resolveDestNamespace(ns, namespace, effectiveValues)}
        pluginChartVersion={effectiveVersion ?? ""}
        pluginInputError={pluginInputError}
        pluginState={pluginStateRef.current}
        onPluginState={(s) => {
          pluginStateRef.current = s;
        }}
      />

      {/* On upgrade, let the other sections be edited too (tabs + actions), like
          on the product page, but into the same values and as a single MR. */}
      {upgrade && schema && viewDoc && draft && (
        <UpgradeExtras
          request={{ ...draft, chart_version: targetVersion, values_yaml: yaml.dump(pruneEmpty(values)) }}
          doc={viewDoc}
          schema={schema as Record<string, any>}
          onValues={setValues}
        />
      )}

      {submitErr && (
        <FormErrors
          message={submitErr.message}
          details={submitErr.details}
          fieldErrors={showErrors && clientErrors.size > 0 ? clientErrors : undefined}
          schema={schema ?? undefined}
          view={orderView}
        />
      )}

      <div className="flex gap-2">
        {upgrade ? (
          <Button
            variant="primary"
            isDisabled={submitting || !targetVersion}
            onPress={doUpgrade}
          >
            {busy === "submit" ? "Обновляем…" : `Обновить до ${targetVersion}`}
          </Button>
        ) : (
          <>
            <Button
              variant="primary"
              isDisabled={submitting || !effectiveVersion || (!editing && !activeTeam)}
              onPress={submit}
            >
              {busy === "submit" ? "Заказываем…" : "Заказать"}
            </Button>
            <Button variant="secondary" isDisabled={submitting || !effectiveVersion} onPress={saveDraft}>
              {busy === "draft" ? "Сохраняем…" : "Сохранить черновик"}
            </Button>
          </>
        )}
        <Button variant="secondary" isDisabled={submitting} onPress={() => navigate(-1)}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

// UpgradeExtras renders the product's other sections (list tabs + the info-menu
// actions) on the upgrade page, so listeners/routes/resources can be edited too,
// not just the order form. It edits the same local values via persist (no API)
// and reuses the exact product-page components, so it matches the live page; the
// whole thing is submitted as one upgrade MR by the parent.
function UpgradeExtras({
  request,
  doc,
  schema,
  onValues,
}: {
  request: OrderRequest;
  doc: ViewDocument;
  schema: Record<string, any>;
  onValues: (v: Values) => void;
}) {
  const tabs = productTabs(doc);
  const persist: PersistValues = (v) => onValues(v as Values);
  const hasInfoActions = actionViews(doc, "info").some((a) => doc.views?.[a.view]);
  if (tabs.length === 0 && !hasInfoActions) return null;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-700">Конфигурация</h2>
        <GenericInfoActions
          request={request}
          doc={doc}
          onChanged={() => {}}
          schema={schema}
          persist={persist}
        />
      </div>
      {tabs.length > 0 && (
        <Tabs>
          <TabList aria-label="Разделы" className="flex gap-1 border-b border-gray-200">
            {tabs.map((t) => (
              <DetailTab key={t.id} id={t.id}>
                {t.title ?? t.id}
              </DetailTab>
            ))}
          </TabList>
          {tabs.map((t) => (
            <TabPanel key={t.id} id={t.id} className="pt-4 outline-none">
              <GenericListTab
                request={request}
                modifiable
                reload={() => {}}
                doc={doc}
                tab={t}
                schema={schema}
                persist={persist}
              />
            </TabPanel>
          ))}
        </Tabs>
      )}
    </Card>
  );
}
