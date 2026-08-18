// Preview of a version's view document, built from the same components as the
// real pages: the order form from OrderFormParts and the product page from
// ProductView. What is rendered here is what the user will get, which is the
// whole point - both the author writing the document and the admin approving it
// need to see the form, not the JSON that produces it.
//
// Shared by the version editor (/catalog/:project/:name/manage/:version) and the
// approval screen (/admin/approvals/:project/:name/:version). Values are local:
// filling the preview in writes to component state, never to the API.

import yaml from "js-yaml";
import { Component, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Button as AriaButton,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Tooltip,
  TooltipTrigger,
} from "react-aria-components";
import { IconInfoCircle } from "@tabler/icons-react";
import type { OrderRequest, ViewDocument } from "@/api/types";
import { useUser } from "@/auth/UserContext";
import { ProductIcon } from "@/components/icons";
import type { PersistValues } from "@/components/products/GenericProductTabs";
import { StatusBadge } from "@/components/StatusBadge";
import { Card } from "@/components/ui";
import { parseNamespaceDirective, resolveDestNamespace } from "@/form/namespace";
import { pruneEmpty, type View } from "@/form/SchemaForm";
import { OrderMetaCard, OrderValuesCard } from "../orders/OrderFormParts";
import { Meta, ProductView } from "../orders/requestDetailParts";
import { valuesEditorFor } from "../orders/valuesEditors";

type Values = Record<string, unknown>;

// EditorTab is the tab style shared by the document tabs and the preview tabs,
// so both strips read as one control rather than two designs on one screen.
export function EditorTab({
  id,
  info,
  children,
}: {
  id: string;
  info?: string;
  children: ReactNode;
}) {
  return (
    <Tab
      id={id}
      className="-mb-px cursor-pointer border-b-2 border-transparent px-3 py-2 text-sm font-medium text-gray-500 outline-none transition-colors hover:text-gray-700 selected:border-brand-600 selected:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      <span className="inline-flex items-center gap-1.5">
        {children}
        {info && <InfoHint text={info} />}
      </span>
    </Tab>
  );
}

// Info hint: a small "i" that shows short text in a tooltip on hover/focus.
// excludeFromTabOrder so it does not interfere with arrow-key navigation (e.g.
// across the tabs it sits next to).
export function InfoHint({ text }: { text: string }) {
  return (
    <TooltipTrigger delay={150} closeDelay={0}>
      <AriaButton
        excludeFromTabOrder
        aria-label={text}
        className="inline-flex items-center text-slate-400 outline-none transition-colors hover:text-brand-600 focus-visible:text-brand-600"
      >
        <IconInfoCircle size={15} stroke={1.8} />
      </AriaButton>
      <Tooltip
        offset={6}
        className="max-w-xs rounded-md border border-slate-200 bg-surface px-2.5 py-1.5 text-xs text-slate-700 shadow-lg entering:animate-in entering:fade-in entering:zoom-in-95"
      >
        {text}
      </Tooltip>
    </TooltipTrigger>
  );
}

// useHorizontalSplit drives the draggable divider between a left panel and a
// right one: the left panel's share in %, applied only where the two sit side by
// side. Returns the container ref to measure against, the share, and the handler
// that starts a drag.
export function useHorizontalSplit(initialPct = 50) {
  const ref = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(initialPct);
  const dragging = useRef(false);

  function onPointerDown(e: React.PointerEvent) {
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  }

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const el = ref.current;
      if (!dragging.current || !el) return;
      const r = el.getBoundingClientRect();
      setPct(Math.min(75, Math.max(25, ((e.clientX - r.left) / r.width) * 100)));
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  return { ref, pct, onPointerDown };
}

// SplitHandle is the divider itself: a grab area between the two panels, shown
// only where they are side by side.
export function SplitHandle({ onPointerDown }: { onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      className="group hidden shrink-0 cursor-col-resize touch-none items-stretch justify-center px-1.5 lg:flex"
    >
      <div className="w-1 rounded-full bg-slate-200 transition-colors group-hover:bg-brand-400" />
    </div>
  );
}

// readPointer pulls a string out of values by JSON pointer (preview identity).
export function readPointer(v: unknown, ptr: string): string {
  if (!ptr.startsWith("/")) return "";
  let cur: any = v;
  for (const seg of ptr.split("/").slice(1)) {
    if (cur == null) return "";
    cur = Array.isArray(cur) ? cur[Number(seg)] : cur[seg];
  }
  return typeof cur === "string" ? cur : "";
}

// PreviewBoundary contains render crashes caused by a broken intermediate view
// document (the author edits live JSON, so any shape can flow into the form).
// Without it the error escalates to the router's error page and kills the whole
// editor; here only the preview panel degrades to a hint. resetKey (the raw
// document text) retries the render after each edit, so no manual reload is
// needed; while the render succeeds the children stay mounted and keep their
// preview state.
export class PreviewBoundary extends Component<
  { resetKey: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }
  render() {
    if (this.state.failed)
      return (
        <p className="text-sm text-gray-500">
          Предпросмотр не построился по текущему документу. Продолжайте правку - форма появится,
          когда документ снова станет корректным.
        </p>
      );
    return this.props.children;
  }
}

// The preview is built from the same components as the real pages (the order
// form from OrderFormParts, the product page from ProductView), so it matches
// exactly what the user will see. Values are local: edits in the preview go to
// state (persist), not the API.
export function PreviewPane({
  schema,
  doc,
  label,
  project,
  name,
  version,
}: {
  schema: Record<string, any>;
  doc: ViewDocument;
  label: string;
  project: string;
  name: string;
  version: string;
}) {
  const { user } = useUser();
  const orderView = doc.views?.order as (View & { identity?: string; namespace?: unknown }) | undefined;
  const identity = orderView?.identity;
  const ns = parseNamespaceDirective(orderView?.namespace);

  // Order state: shared between the form and the product page (fill the form,
  // switch the tab and you see your order).
  const [values, setValues] = useState<Values>({});
  const [displayName, setDisplayName] = useState(label);
  const [serviceName, setServiceName] = useState("");
  const [cluster, setCluster] = useState("in-cluster");
  const [namespace, setNamespace] = useState("");
  const [mode, setMode] = useState<string>("form");
  const [raw, setRaw] = useState("");

  // The extra values editor the document under edit turns on. Reading it from
  // the draft means the author sees the tab appear as soon as the "graph" block
  // is valid, which is the whole point of previewing.
  const editor = useMemo(() => valuesEditorFor(doc), [doc]);
  // Canvas state the editor keeps beyond the values; the preview holds it for
  // the session so switching tabs does not wipe what was drawn.
  const editorStateRef = useRef<unknown>(null);

  // The same form/raw switching logic as on the order page. Leaving raw adopts
  // the YAML; a plugin mode is entered with the values as they are.
  function switchMode(next: string) {
    if (next === mode) return;
    if (next === "raw") {
      setRaw(yaml.dump(pruneEmpty(values)));
    } else if (mode === "raw") {
      try {
        setValues((yaml.load(raw) as Values) ?? {});
      } catch {
        /* keep previous form values if YAML is invalid */
      }
    }
    setMode(next);
  }

  // The tab disappears while the author edits the block; do not leave the card
  // in a mode that no longer exists.
  useEffect(() => {
    if (mode !== "form" && mode !== "raw" && editor?.plugin.id !== mode) setMode("form");
  }, [editor, mode]);

  const team = user?.teams?.[0] ?? "team";
  const svcName = (identity ? readPointer(values, identity) : serviceName) || "demo-service";

  // Synthetic order: lets the preview render with the real product components
  // without a saved order. The id is fake, writes go through persist.
  const request: OrderRequest = {
    id: "preview",
    created_by: user?.sub ?? "",
    created_by_name: user?.name ?? "",
    team,
    chart_project: project,
    chart_name: name,
    chart_version: version,
    service_name: svcName,
    display_name: displayName,
    cluster,
    namespace: namespace || svcName,
    values_yaml: yaml.dump(pruneEmpty(values)),
    status: "HEALTHY",
    argocd_app_name: `${team}-${svcName}`,
    version: 1,
    created_at: "",
    updated_at: "",
    drifted: false,
    imported: false,
  };

  return (
    <Tabs className="flex min-h-0 flex-1 flex-col">
      <TabList aria-label="Предпросмотр" className="flex gap-1 border-b border-gray-200">
        <EditorTab id="order" info="Предпросмотр формы нового заказа">
          Форма заказа
        </EditorTab>
        <EditorTab id="product" info="Предпросмотр страницы заказанного продукта">
          Страница продукта
        </EditorTab>
      </TabList>
      {/* relative: this scroll container is the containing block for react-aria's
          absolutely-positioned hidden nodes (VisuallyHidden inside Select). Without
          it they anchor to the nearest positioned ancestor (main) at their deep
          static position and inflate main's scrollHeight - a phantom empty gap
          below the side-by-side builder. Anchored here, they sit inside the panel's
          own overflow-y-auto and add nothing to the page. */}
      <TabPanel
        id="order"
        className="relative flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1 pt-3 outline-none"
      >
        {orderView ? (
          <>
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
              namespaceHint={ns.hideField ? resolveDestNamespace(ns, namespace, values) : undefined}
              team={team}
              version={version}
              latest
              identityName={identity ? readPointer(values, identity) : ""}
            />
            <OrderValuesCard
              schema={schema}
              view={orderView}
              values={values}
              onValues={setValues}
              mode={mode}
              onSwitchMode={switchMode}
              raw={raw}
              onRaw={setRaw}
              editor={editor}
              pluginNamespace={resolveDestNamespace(ns, namespace, values)}
              pluginChartVersion={version}
              pluginState={editorStateRef.current}
              onPluginState={(st) => {
                editorStateRef.current = st;
              }}
            />
          </>
        ) : (
          <p className="text-sm text-gray-500">
            В документе нет view "order", форма заказа не строится.
          </p>
        )}
      </TabPanel>
      <TabPanel
        id="product"
        className="relative flex min-h-0 flex-1 flex-col overflow-y-auto pr-1 pt-3 outline-none"
      >
        <ProductPagePreview
          request={request}
          doc={doc}
          schema={schema}
          persist={(v) => setValues(v as Values)}
        />
      </TabPanel>
    </Tabs>
  );
}

// ProductPagePreview shows the order's product page exactly as RequestDetailPage
// renders it: the same header + meta card layout and the shared ProductView
// (tabs, tables, the actions menu). Edits write to local state via persist.
function ProductPagePreview({
  request,
  doc,
  schema,
  persist,
}: {
  request: OrderRequest;
  doc: ViewDocument;
  schema: Record<string, any>;
  persist: PersistValues;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
          <ProductIcon project={request.chart_project} name={request.chart_name} size={22} />
        </span>
        <h1 className="truncate text-xl font-semibold">
          {request.display_name || request.service_name}
        </h1>
      </div>
      <Card className="grid grid-cols-3 gap-4">
        <Meta label="Создатель">
          <span className="text-sm text-gray-800">{request.created_by_name || "-"}</span>
        </Meta>
        <Meta label="Создан">
          <span className="text-sm text-gray-800">-</span>
        </Meta>
        <Meta label="Статус">
          <StatusBadge status={request.status} />
        </Meta>
      </Card>
      <ProductView
        request={request}
        doc={doc}
        modifiable
        reload={() => {}}
        schema={schema}
        persist={persist}
      />
    </div>
  );
}
