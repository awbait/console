// The admin's decision surface for one submitted version of a service.
//
// Approving a version publishes an order form to everyone, so the reviewer has
// to see that form, not only the JSON behind it. The layout mirrors the version
// editor the author works in (/catalog/:project/:name/manage/:version): document
// on the left, live preview on the right, same splitter - the two people look at
// the same screen and talk about the same thing.

import { DiffEditor, default as Editor } from "@monaco-editor/react";
import {
  IconArrowLeft,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconPackage,
} from "@tabler/icons-react";
import { useState } from "react";
import { TabList, TabPanel, Tabs } from "react-aria-components";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, HttpError } from "../api/client";
import { qk } from "../api/queryKeys";
import type { ChartPublication, ViewDocument } from "../api/types";
import { chartLabel, useCatalog } from "../app/CatalogContext";
import { useTheme } from "../app/ThemeContext";
import { useToast } from "../app/ToastContext";
import { useTeamLabel } from "../auth/UserContext";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { FormErrors } from "../components/FormErrors";
import { ProductIcon } from "../components/icons";
import { Button, Card, Chip, ErrorBox, Loading, TextField } from "../components/ui";
import {
  EditorTab,
  PreviewBoundary,
  PreviewPane,
  SplitHandle,
  useHorizontalSplit,
} from "../features/publications/viewPreview";
import { useAsync } from "../hooks/useAsync";

export function VersionApprovalPage() {
  const { project = "", name = "", version = "" } = useParams();
  const {
    data: pub,
    loading,
    error,
  } = useAsync(
    (signal) => api.findPublication(project, name, signal),
    [project, name],
    qk.publication(project, name),
  );

  const back = (
    <Link
      to="/admin/approvals"
      className="inline-flex w-fit items-center gap-1 text-sm text-slate-500 outline-none hover:text-slate-700 focus-visible:text-brand-600"
    >
      <IconArrowLeft size={16} stroke={1.8} /> Согласование публикаций
    </Link>
  );

  if (loading && !pub) return <Loading label="Загружаем версию" />;
  if (error && !pub) return <ErrorBox error={error} />;
  if (!pub) {
    return (
      <div className="flex flex-col gap-5">
        {back}
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Публикация {project}/{name} не найдена.
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Breadcrumbs
        items={[
          { label: "Согласование публикаций", to: "/admin/approvals" },
          { label: `${project}/${name}`, to: `/admin/approvals/${project}/${name}` },
          { label: version },
        ]}
      />
      <VersionApproval key={version} pub={pub} version={version} />
    </div>
  );
}

function VersionApproval({ pub, version }: { pub: ChartPublication; version: string }) {
  const { theme } = useTheme();
  const monacoTheme = theme === "light" ? "light" : "vs-dark";
  const { success } = useToast();
  const { reload: reloadCatalog } = useCatalog();
  const teamLabel = useTeamLabel();
  const navigate = useNavigate();
  const project = pub.chart_project;
  const name = pub.chart_name;

  const { data: versions, reload: reloadVersions } = useAsync(
    () => api.listVersions(pub.id),
    [pub.id],
    qk.versions(pub.id),
  );
  // The chart's own schema: the preview builds the order form out of it, exactly
  // as the order page will.
  const { data: schema } = useAsync(
    () => api.getSchema(project, name, version),
    [project, name, version],
    qk.schema(project, name, version),
  );

  const cur = versions?.find((v) => v.chart_version === version) ?? null;

  const [busy, setBusy] = useState<null | "approve" | "reject">(null);
  const [rejectComment, setRejectComment] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function decide(action: "approve" | "reject") {
    setBusy(action);
    setErr(null);
    try {
      if (action === "approve") {
        await api.approveVersion(pub.id, version);
        success(`Версия ${version} согласована`);
      } else {
        await api.rejectVersion(pub.id, version, rejectComment.trim());
        success(`Версия ${version} отклонена`);
      }
      reloadVersions();
      reloadCatalog();
      navigate("/admin/approvals");
    } catch (e) {
      setErr(e instanceof HttpError ? e.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!versions) return <Loading label="Загружаем версию" />;
  if (!cur) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Версия {version} у этой публикации не заведена.
      </div>
    );
  }

  const pending = cur.status === "PENDING";
  const submitted = JSON.stringify(cur.view_json ?? {}, null, 2);
  const approved = cur.approved_view_json
    ? JSON.stringify(cur.approved_view_json, null, 2)
    : null;
  // The preview is built from what is being decided on: the submitted document.
  const doc = (cur.view_json ?? {}) as ViewDocument;

  return (
    // Same shell as the version editor: one flex column that owns the page's
    // free height, so the document and the preview fill it and scroll inside
    // themselves instead of growing the page.
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
          <ProductIcon project={project} name={name} size={22} />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-slate-900">
            {chartLabel(name)} <span className="text-slate-400">v{version}</span>
          </h1>
          <p className="truncate text-xs text-slate-400">
            {project}/{name}
          </p>
        </div>
        {pending ? (
          <Chip className="bg-amber-50 text-amber-700">
            <IconClock size={13} stroke={1.8} className="text-amber-500" /> На согласовании
          </Chip>
        ) : (
          <Chip className="bg-slate-100 text-slate-600">
            <IconPackage size={13} stroke={1.8} className="text-slate-400" /> {cur.status}
          </Chip>
        )}
        <Chip className="bg-brand-50 text-brand-700">{teamLabel(pub.owner_team)}</Chip>
      </div>

      {!pending && (
        <div className="rounded-md border border-slate-200 bg-surface p-4 text-sm text-slate-600">
          Эта версия не на согласовании, решать нечего. Ниже - её документ и то, как выглядит
          форма заказа по нему.
        </div>
      )}

      <SplitLayout
        left={
          <Tabs className="flex min-h-0 flex-1 flex-col">
            <TabList aria-label="Документы" className="flex gap-1 border-b border-gray-200">
              <EditorTab id="doc" info="Документ, который отправили на согласование">
                view.schema.json
              </EditorTab>
              <EditorTab
                id="diff"
                info={
                  approved
                    ? "Что изменилось против действующего документа версии"
                    : "Действующего документа нет: это первое согласование версии"
                }
              >
                Изменения
              </EditorTab>
            </TabList>
            <TabPanel id="doc" className="flex min-h-0 flex-1 flex-col pt-3 outline-none">
              <div className="editor-frame min-h-[400px] flex-1 rounded-md border border-slate-200 lg:min-h-0">
                <Editor
                  height="100%"
                  defaultLanguage="json"
                  theme={monacoTheme}
                  value={submitted}
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    fontSize: 13,
                    automaticLayout: true,
                    wordWrap: "on",
                  }}
                />
              </div>
            </TabPanel>
            <TabPanel id="diff" className="flex min-h-0 flex-1 flex-col pt-3 outline-none">
              {approved ? (
                <div className="editor-frame min-h-[400px] flex-1 rounded-md border border-slate-200 lg:min-h-0">
                  <DiffEditor
                    height="100%"
                    language="json"
                    theme={monacoTheme}
                    original={approved}
                    modified={submitted}
                    options={{
                      readOnly: true,
                      renderSideBySide: true,
                      minimap: { enabled: false },
                      fontSize: 12,
                      automaticLayout: true,
                    }}
                  />
                </div>
              ) : (
                <p className="rounded-md border border-slate-200 bg-app p-3 text-sm text-slate-500">
                  Версия согласуется впервые, сравнивать не с чем. Смотрите сам документ рядом и
                  форму заказа справа.
                </p>
              )}
            </TabPanel>
          </Tabs>
        }
        right={
          schema ? (
            <PreviewBoundary resetKey={submitted}>
              <PreviewPane
                schema={schema}
                doc={doc}
                label={chartLabel(name)}
                project={project}
                name={name}
                version={version}
              />
            </PreviewBoundary>
          ) : (
            <p className="text-sm text-gray-500">Загружаем схему чарта для предпросмотра...</p>
          )
        }
      />

      {pending && (
        <Card className="flex flex-col gap-3 border-amber-200">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextField
                label="Комментарий (для отклонения)"
                value={rejectComment}
                onChange={(v) => setRejectComment(v)}
              />
            </div>
            <Button variant="primary" isDisabled={busy !== null} onPress={() => decide("approve")}>
              <IconCircleCheck size={16} stroke={1.8} /> Согласовать
            </Button>
            <Button variant="danger" isDisabled={busy !== null} onPress={() => decide("reject")}>
              <IconCircleX size={16} stroke={1.8} /> Отклонить
            </Button>
          </div>
          {err && <FormErrors message={err} />}
        </Card>
      )}
    </div>
  );
}

// SplitLayout is the two-panel body shared with the version editor: side by side
// with a draggable divider on wide screens, stacked below that so neither panel
// is crushed into an unusable height.
function SplitLayout({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  const { ref, pct, onPointerDown } = useHorizontalSplit();
  return (
    <div
      ref={ref}
      className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row lg:gap-0"
      style={{ ["--split" as string]: `${pct}%` } as React.CSSProperties}
    >
      <Card className="flex flex-col gap-2 lg:min-h-0 lg:min-w-0 lg:shrink-0 lg:basis-[var(--split)]">
        {left}
      </Card>
      <SplitHandle onPointerDown={onPointerDown} />
      <Card className="flex flex-col gap-2 lg:min-h-0 lg:min-w-0 lg:flex-1">{right}</Card>
    </div>
  );
}
