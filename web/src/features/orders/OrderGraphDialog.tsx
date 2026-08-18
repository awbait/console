// The graph of a live order: the same canvas the order form draws, over the
// values the service is running on.
//
// It opens in a window of its own, not in a tab. A graph is read by following
// arrows across it, and a panel inside a scrolling page gives it a strip about
// four boxes wide - enough to prove the feature exists, not enough to work in.
// The window takes almost the whole screen, which is the smallest space in which
// a topology reads as one picture.
//
// Two kinds of edit come off that canvas, and they are not the same thing at all:
//
//   arrows   change the values, so they are a change to the service: they wait
//            for the Save button and go the way every other change goes.
//   layout   (a node moved, a workload parked with nothing linked to it yet) is
//            not part of the service at all. It is sent quietly, with the values
//            untouched, and the backend stores it without opening a change - see
//            the empty diff case in internal/provisioning/service.go.
//
// So the picture keeps the arrangement its author gave it, and tidying the canvas
// never counts as editing the service.
//
// The state lives here rather than inside the window: closing the window is not
// throwing the work away, so unsaved arrows survive it and the button says they
// are there. Nothing to warn about, nothing to confirm.

import { IconAlertTriangle, IconInfoCircle, IconSitemap, IconX } from "@tabler/icons-react";
import yaml from "js-yaml";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Button as AriaButton,
  Dialog,
  DialogTrigger,
  Heading,
  Modal,
  ModalOverlay,
} from "react-aria-components";
import { api } from "@/api/client";
import type { OrderRequest, RequestMR, ViewDocument } from "@/api/types";
import { useToast } from "@/app/ToastContext";
import { FormErrors, type SubmitError, toSubmitError } from "@/components/FormErrors";
import type { PersistValues } from "@/components/products/GenericProductTabs";
import { Button, buttonClass } from "@/components/ui";
import { entriesHiddenFromTabs, entryCount, graphLock, sameValues } from "./orderGraph";
import type { ActiveValuesEditor } from "./valuesEditors";

type Values = Record<string, unknown>;

// How long a canvas has to be still before its arrangement is sent. Long enough
// that dragging a node across the screen is one save, short enough that nobody
// closes the window in between.
const LAYOUT_SAVE_DELAY = 1200;

function parseValues(text: string): Values {
  try {
    return (yaml.load(text) as Values) ?? {};
  } catch {
    return {};
  }
}

export function OrderGraphDialog({
  request: r,
  doc,
  editor,
  modifiable,
  openMR,
  reload,
  persist,
}: {
  request: OrderRequest;
  doc: ViewDocument;
  editor: ActiveValuesEditor;
  modifiable: boolean;
  openMR?: RequestMR | null;
  reload: () => void;
  // Preview only (chart editor): edits go to local state instead of the API.
  persist?: PersistValues;
}) {
  const { plugin, mapping } = editor;
  const toast = useToast();
  const saved = useMemo(() => parseValues(r.values_yaml), [r.values_yaml]);
  const [draft, setDraft] = useState<Values | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<SubmitError | null>(null);
  // The canvas is remounted after a save so it re-reads the stored values and the
  // stored arrangement together, instead of holding a model built on both.
  const [generation, setGeneration] = useState(0);

  const lock = graphLock(r, modifiable, openMR);
  const values = draft ?? saved;
  const dirty = draft !== null && !sameValues(draft, saved);
  const hidden = entriesHiddenFromTabs(doc, mapping, entryCount(values, mapping));

  // The arrangement travels beside the values, so it is sent with the values the
  // server already has - never with the arrows still being drawn. Otherwise
  // tidying the canvas would submit an unfinished change.
  const layout = useRef<unknown>(undefined);
  const layoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (layoutTimer.current) clearTimeout(layoutTimer.current);
    },
    [],
  );

  function onEditorState(state: unknown) {
    layout.current = state;
    if (lock || persist) return; // nothing to store against, or a preview
    if (layoutTimer.current) clearTimeout(layoutTimer.current);
    layoutTimer.current = setTimeout(() => {
      // Failures here are deliberately silent: the arrangement is a convenience,
      // and an error for a node nobody asked to save would be noise. It travels
      // again with the next real change.
      api.updateRequest(r.id, { values: saved, editor_state: layout.current }).catch(() => {});
    }, LAYOUT_SAVE_DELAY);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setErr(null);
    if (layoutTimer.current) clearTimeout(layoutTimer.current);
    try {
      if (persist) {
        await persist(draft);
      } else {
        await api.updateRequest(r.id, { values: draft, editor_state: layout.current });
        reload();
      }
      setDraft(null);
      setGeneration((g) => g + 1);
      toast.success("Изменения сохранены");
    } catch (e) {
      setErr(toSubmitError(e));
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setDraft(null);
    setErr(null);
    setGeneration((g) => g + 1);
  }

  return (
    <DialogTrigger>
      <AriaButton className={buttonClass("secondary", "relative shrink-0 cursor-pointer")}>
        <IconSitemap size={16} stroke={1.8} className="text-slate-400" />
        {plugin.label}
        {/* Unsaved arrows are the one thing the closed window has to say out
            loud: the work is still here, it is just not in the service yet. */}
        {dirty && (
          <span
            title="Есть несохранённые изменения"
            className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-brand-500 ring-2 ring-surface"
          />
        )}
      </AriaButton>
      {/* Almost the whole screen: a graph is the one thing on this page that is
          worth the room, and the values behind it are read from the fields. */}
      <ModalOverlay
        isDismissable
        className="fixed inset-0 z-50 flex items-center justify-center scrim p-3 sm:p-6 entering:animate-in entering:fade-in"
      >
        <Modal className="flex h-[92vh] w-full max-w-[1500px] flex-col rounded-lg bg-surface shadow-xl outline-none entering:animate-in entering:zoom-in-95">
          <Dialog className="flex min-h-0 flex-1 flex-col outline-none">
            {({ close }) => (
              <>
                <header className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <Heading slot="title" className="text-sm font-semibold text-gray-700">
                      {plugin.label}
                    </Heading>
                    <span className="truncate text-xs text-slate-400">
                      {r.display_name || r.service_name}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {dirty && !lock && (
                      <>
                        <Button onPress={discard} isDisabled={saving}>
                          Отменить
                        </Button>
                        <Button variant="primary" onPress={save} isDisabled={saving}>
                          {saving ? "Сохраняем…" : "Сохранить"}
                        </Button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={close}
                      aria-label="Закрыть"
                      className="rounded-md p-1 text-gray-400 outline-none hover:bg-gray-100 hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-brand-500"
                    >
                      <IconX size={18} stroke={2} />
                    </button>
                  </div>
                </header>
                <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
                  {lock && <Note text={lock.text} />}
                  {hidden && (
                    <Note
                      warning
                      text="Правила второй и следующих нагрузок видны только здесь: вкладки правил показывают первую."
                    />
                  )}
                  {err && <FormErrors message={err.message} details={err.details} />}
                  <div className="min-h-0 flex-1">
                    <Suspense
                      fallback={
                        <p className="py-8 text-center text-sm text-slate-400">Готовим граф…</p>
                      }
                    >
                      <plugin.Component
                        key={`${r.namespace}:${generation}`}
                        values={values}
                        onValues={setDraft}
                        namespace={r.namespace}
                        chartVersion={r.chart_version}
                        mapping={mapping}
                        readOnly={lock !== null}
                        fill
                        editorState={r.editor_state}
                        onEditorState={onEditorState}
                      />
                    </Suspense>
                  </div>
                </div>
              </>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}

function Note({ text, warning = false }: { text: string; warning?: boolean }) {
  const Icon = warning ? IconAlertTriangle : IconInfoCircle;
  return (
    <p
      className={`flex shrink-0 items-start gap-2 rounded-md border p-3 text-sm ${
        warning
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-slate-200 bg-app text-slate-600"
      }`}
    >
      <Icon size={16} stroke={1.8} className="mt-0.5 shrink-0" />
      {text}
    </p>
  );
}
