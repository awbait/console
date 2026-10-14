import {
  IconDatabase,
  IconDots,
  IconGitBranch,
  IconLoader2,
  IconPlus,
  IconRocket,
  IconServer,
  IconSettings,
  IconStar,
  IconTrash,
} from "@tabler/icons-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button as AriaButton, Menu, MenuItem, MenuTrigger, Popover, Separator } from "react-aria-components";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../api/client";
import { qk } from "../api/queryKeys";
import type { Stand, StandLayout, StandMode } from "../api/types";
import { useToast } from "../app/ToastContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FormDialogShell } from "../components/FormDialogShell";
import { Button, ErrorBox, Hint, Select, SkeletonRows, TextField } from "../components/ui";
import { standText as t } from "../features/stands/text";
import { dnsLabelError, fieldMsg } from "../form/fieldErrors";
import { useAsync } from "../hooks/useAsync";

// Stands: the places orders go to. The list is a read-only overview: a row
// shows the stand's mode, cluster, Git path and state. Adding and editing go
// through one slide-over with labelled fields grouped by meaning (general, Git,
// Argo CD) and an explicit save button. The layout and the path freeze as soon
// as the stand has orders, and a new mode on a stand with orders starts a job
// that moves them, asked for first.

// The cluster rule mirrors the one the portal checks (a DNS label), worded
// from the shared table so the complaint here and the one from the server
// read the same.
function clusterError(cluster: string): string | null {
  if (!cluster) return null;
  return dnsLabelError(cluster);
}

// The path rule mirrors the portal's: GitLab path segments, slash-separated.
const GIT_PATH_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*(\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;

function pathError(path: string): string | null {
  if (!path) return null;
  return GIT_PATH_RE.test(path) && path.length <= 255 ? null : t.errPath;
}

// The registry rule mirrors the portal's: a host with an optional port and
// path, no scheme, because it lands in an OCI repoURL.
const REGISTRY_RE = /^[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?(\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;

function registryError(registry: string): string | null {
  if (!registry) return null;
  return REGISTRY_RE.test(registry) && registry.length <= 255 ? null : t.errRegistry;
}

// The stand's Git address for its Argo CD mirrors the portal's rule: http or
// https, a host, an optional port and path, nothing after it.
const GIT_URL_RE = /^https?:\/\/[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?(\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;

function gitUrlError(url: string): string | null {
  if (!url) return null;
  return GIT_URL_RE.test(url) && url.length <= 255 ? null : t.errGitUrl;
}

// The Argo CD namespace is a Kubernetes name, the rule of a cluster name.
function argoNsError(ns: string): string | null {
  if (!ns) return null;
  return dnsLabelError(ns) ? t.errArgoNs : null;
}

const LAYOUTS: { id: StandLayout; label: string; hint: string }[] = [
  { id: "group", label: t.layoutGroup, hint: t.layoutGroupHint },
  { id: "repository", label: t.layoutRepository, hint: t.layoutRepositoryHint },
];

// Each mode keeps its own icon next to its name, so the column reads at a
// glance without leaning on the words.
const MODES: { id: StandMode; label: string; hint: string; Icon: typeof IconRocket }[] = [
  { id: "deploy", label: t.modeDeploy, hint: t.modeDeployHint, Icon: IconRocket },
  { id: "git", label: t.modeGit, hint: t.modeGitHint, Icon: IconGitBranch },
  { id: "console", label: t.modeConsole, hint: t.modeConsoleHint, Icon: IconDatabase },
];

const modeOf = (id: StandMode) => MODES.find((m) => m.id === id) ?? MODES[0];
const layoutOf = (id: StandLayout) => LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0];

// The panel is open for a new stand ("new") or for one of the list's stands.
type PanelTarget = "new" | Stand | null;

export function AdminStandsPage() {
  // Under the shared cache key: the order form and the orders list read the
  // same rows, so an edit here is what they show next.
  const { data, error, loading, reload } = useAsync((signal) => api.listStands(signal), [], qk.stands());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelTarget>(null);
  const toast = useToast();

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      reload();
      if (done) toast.success(done);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const stands = data ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{t.navLabel}</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">{t.pageIntro}</p>
        </div>
        <Button variant="primary" onPress={() => setPanel("new")} isDisabled={loading} className="shrink-0">
          <IconPlus size={16} stroke={2} />
          {t.addButton}
        </Button>
      </div>

      {error && <ErrorBox error={error} />}
      {err && <ErrorBox error={new Error(err)} />}

      <div className="-mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto px-1 pb-1">
        {loading ? (
          <SkeletonRows rows={3} />
        ) : stands.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-surface px-6 py-12 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <IconServer size={22} stroke={1.8} />
            </span>
            <p className="max-w-md text-sm text-slate-500">{t.emptyList}</p>
            <Button variant="secondary" onPress={() => setPanel("new")}>
              <IconPlus size={16} stroke={2} />
              {t.addButton}
            </Button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-surface shadow-sm">
            {/* Wider than the window rides sideways rather than wrapping, and
                the actions stay pinned to the right edge. */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[48rem] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <Th>{t.tableColumn}</Th>
                    <Th>{t.modeLabel}</Th>
                    <Th>{t.clusterAria}</Th>
                    <Th>{t.pathLabel}</Th>
                    <Th>{t.columnState}</Th>
                    <Th className={`${stickyEnd} bg-surface`}>
                      <span className="sr-only">{t.moreActions}</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {stands.map((s) => (
                    <StandRow
                      key={s.id}
                      stand={s}
                      busy={busy}
                      isLast={stands.length <= 1}
                      onEdit={() => setPanel(s)}
                      onMakeDefault={() => run(() => api.setDefaultStand(s.id), t.toastDefault(s.name))}
                      onDelete={async (name) => {
                        await api.deleteStand(s.id, name);
                        reload();
                        toast.success(t.deleteStartedToast(s.name));
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <StandPanel
        target={panel}
        onClose={() => setPanel(null)}
        onDone={(msg) => {
          setPanel(null);
          reload();
          toast.success(msg);
        }}
      />
    </div>
  );
}

function Th({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <th className={`whitespace-nowrap border-b border-slate-200 px-4 py-2.5 font-medium ${className}`}>{children}</th>;
}

const td = "border-b border-slate-100 px-4 py-3 align-middle group-last:border-b-0";

// The actions column stays at the right edge while the table rides sideways
// in a narrow window, on the row's own background so nothing shows through.
const stickyEnd = "sticky right-0 w-px";

// StandRow is one stand on one line, all in the same plain type: the full
// settings live in the panel, so the row carries only what tells stands apart.
// The state cell speaks only when the stand asks for attention.
function StandRow({
  stand,
  busy,
  isLast,
  onEdit,
  onMakeDefault,
  onDelete,
}: {
  stand: Stand;
  busy: boolean;
  // The only stand left cannot be deleted.
  isLast: boolean;
  onEdit: () => void;
  onMakeDefault: () => void;
  // Starts deleting the stand; name is what the admin typed. Throws to keep
  // the dialog open with the reason.
  onDelete: (name: string) => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const mode = modeOf(stand.mode);
  // Why the stand cannot be deleted right now, or null when it can.
  const deleteBlocked = stand.default
    ? t.deleteDisabledDefault
    : isLast
      ? t.deleteDisabledLast
      : stand.job
        ? t.deleteDisabledJob
        : null;

  return (
    <tr className="group transition-colors hover:bg-slate-50">
      <td className={`${td} whitespace-nowrap`}>
        <Link
          to={`/admin/stands/${stand.id}`}
          title={t.openPage}
          className="rounded font-medium text-slate-800 outline-none hover:text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {stand.name}
        </Link>
        {stand.default && (
          <span
            title={t.defaultHint}
            className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 align-middle text-[11px] font-medium text-brand-700"
          >
            {t.defaultBadge}
          </span>
        )}
      </td>
      <td className={`${td} whitespace-nowrap text-slate-600`} title={mode.hint}>
        <span className="inline-flex items-center gap-1.5">
          <mode.Icon size={15} stroke={1.8} className="shrink-0 text-slate-400" />
          {mode.label}
        </span>
      </td>
      <td className={`${td} whitespace-nowrap text-slate-600`}>{stand.default_cluster}</td>
      <td className={`${td} max-w-[20rem] text-slate-600`}>
        {stand.git_path ? (
          <span className="block truncate" title={stand.git_path}>
            {stand.git_path}
          </span>
        ) : (
          // The state column already says the path is missing.
          <span className="text-slate-300">-</span>
        )}
      </td>
      <td className={td}>
        <StandState stand={stand} />
      </td>

      <td className={`${td} ${stickyEnd} bg-surface transition-colors group-hover:bg-slate-50`}>
        <div className="flex items-center justify-end gap-0.5">
          <Hint text={t.editButton}>
            <AriaButton onPress={onEdit} isDisabled={busy} aria-label={t.editButton} className={iconBtn}>
              <IconSettings size={17} stroke={1.8} />
            </AriaButton>
          </Hint>
          <MenuTrigger>
            <AriaButton aria-label={t.moreActions} isDisabled={busy} className={iconBtn}>
              <IconDots size={16} stroke={1.8} />
            </AriaButton>
            <Popover
              placement="bottom end"
              className="min-w-56 rounded-md border border-slate-200 bg-surface py-1 shadow-lg outline-none entering:animate-in entering:fade-in"
            >
              <Menu
                className="outline-none"
                disabledKeys={[...(stand.default ? ["default"] : []), ...(deleteBlocked ? ["delete"] : [])]}
                onAction={(key) => {
                  if (key === "default") onMakeDefault();
                  if (key === "delete") {
                    setConfirmName("");
                    setDeleting(true);
                  }
                }}
              >
                <MenuItem id="default" textValue={t.makeDefault} className={menuItem}>
                  <IconStar size={15} stroke={1.8} className="mt-0.5 shrink-0 text-slate-400" />
                  {t.makeDefault}
                </MenuItem>
                <Separator className="my-1 border-t border-slate-100" />
                <MenuItem id="delete" textValue={t.deleteButton} className={`${menuItem} text-rose-600`}>
                  <IconTrash size={15} stroke={1.8} className="mt-0.5 shrink-0" />
                  <span className="flex flex-col">
                    {t.deleteButton}
                    {/* A disabled item cannot carry a tooltip, so the reason
                        sits under its name instead. */}
                    {deleteBlocked && <span className="max-w-60 text-xs text-slate-500">{deleteBlocked}</span>}
                  </span>
                </MenuItem>
              </Menu>
            </Popover>
          </MenuTrigger>
        </div>

        {/* Deleting asks for the stand's name, the way a repository is deleted
            in GitLab: it takes every order of the stand with it. */}
        <ConfirmDialog
          isOpen={deleting}
          onOpenChange={setDeleting}
          title={t.deleteTitle(stand.name)}
          danger
          confirmLabel={t.deleteConfirm}
          message={
            <div className="flex flex-col gap-3 text-left whitespace-normal">
              <p>{t.deleteMessage}</p>
              <TextField label={t.deleteNameLabel(stand.name)} value={confirmName} onChange={setConfirmName} />
            </div>
          }
          onConfirm={async () => {
            if (confirmName.trim() !== stand.name) throw new Error(t.deleteNameMismatch);
            await onDelete(confirmName.trim());
          }}
        />
      </td>
    </tr>
  );
}

const iconBtn =
  "flex h-9 w-9 items-center justify-center rounded-md text-slate-500 outline-none transition-colors hover:bg-slate-100 hover:text-slate-700 pressed:bg-slate-200 focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50";

const menuItem =
  "flex cursor-pointer items-start gap-2 px-3 py-1.5 text-sm outline-none focus:bg-slate-50 disabled:cursor-not-allowed aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

// StandState speaks only when the stand asks for attention: a job at work on
// it, or a deploying stand whose Argo CD does not see its orders. A stand that
// is fine shows nothing here; the details are on its own page.
function StandState({ stand }: { stand: Stand }) {
  if (stand.job) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-blue-700">
        <IconLoader2 size={14} stroke={2} className="animate-spin motion-reduce:animate-none" />
        {stand.job.kind === "delete"
          ? t.rowDeleteBadge(stand.job.done, stand.job.total)
          : t.rowJobBadge(stand.job.done, stand.job.total)}
      </span>
    );
  }
  if (!stand.git_path) return <StateDot tone="warn" label={t.stateNoPath} hint={t.pathMissing} />;
  if (stand.mode !== "deploy") return <StateDot tone="ok" label={t.stateReady} hint={modeOf(stand.mode).hint} />;
  if (!stand.argo_connected) return <StateDot tone="warn" label={t.stateNotConnected} hint={t.argoNotConnected} />;
  if (!stand.checked_at) return <StateDot tone="idle" label={t.stateNotChecked} hint={t.neverChecked} />;
  return <StateDot tone="ok" label={t.stateConnected} hint={t.argoConnected} />;
}

const DOT_TONE = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  idle: "bg-slate-300",
} as const;

// StateDot is a short state in a word or two; the colour repeats the word and
// the full sentence is behind the hover.
function StateDot({ tone, label, hint }: { tone: keyof typeof DOT_TONE; label: string; hint: string }) {
  return (
    <span
      title={hint}
      className={`inline-flex items-center gap-2 whitespace-nowrap ${tone === "warn" ? "text-amber-700" : "text-slate-600"}`}
    >
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${DOT_TONE[tone]}`} />
      {label}
    </span>
  );
}

interface Draft {
  name: string;
  cluster: string;
  mode: StandMode;
  layout: StandLayout;
  path: string;
  gitUrl: string;
  argoNs: string;
  registry: string;
}

const EMPTY: Draft = {
  name: "",
  cluster: "",
  mode: "deploy",
  layout: "group",
  path: "",
  gitUrl: "",
  argoNs: "",
  registry: "",
};

function draftOf(s: Stand): Draft {
  return {
    name: s.name,
    cluster: s.default_cluster,
    mode: s.mode,
    layout: s.layout,
    path: s.git_path,
    gitUrl: s.git_url ?? "",
    argoNs: s.argocd_namespace ?? "",
    registry: s.chart_registry ?? "",
  };
}

// What goes to the portal: trimmed, with the slashes a path or an address may
// be pasted with taken off.
function normalized(d: Draft) {
  return {
    name: d.name.trim(),
    default_cluster: d.cluster.trim(),
    mode: d.mode,
    layout: d.layout,
    git_path: d.path.trim().replace(/^\/+|\/+$/g, ""),
    git_url: d.gitUrl.trim().replace(/\/+$/g, ""),
    argocd_namespace: d.argoNs.trim(),
    chart_registry: d.registry.trim().replace(/\/+$/g, ""),
  };
}

// StandPanel adds a stand or edits one, in the slide-over the portal uses for
// editing list entries. A malformed value is reported under its field as it
// is typed; a required one left empty only once saving was tried.
function StandPanel({
  target,
  onClose,
  onDone,
}: {
  target: PanelTarget;
  onClose: () => void;
  onDone: (toast: string) => void;
}) {
  const stand = target && target !== "new" ? target : null;
  const [d, setD] = useState<Draft>(EMPTY);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmMode, setConfirmMode] = useState(false);

  useEffect(() => {
    if (!target) return;
    setD(target === "new" ? EMPTY : draftOf(target));
    setTried(false);
    setBusy(false);
    setErr(null);
  }, [target]);

  const set = <K extends keyof Draft>(k: K) => (v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  const n = normalized(d);

  const errors = {
    name: !n.name ? fieldMsg.required : null,
    cluster: clusterError(n.default_cluster) ?? (!n.default_cluster ? fieldMsg.required : null),
    path: pathError(n.git_path) ?? (!n.git_path && !stand?.locked ? t.errPathEmpty : null),
    gitUrl: gitUrlError(n.git_url),
    argoNs: argoNsError(n.argocd_namespace),
    registry: registryError(n.chart_registry),
  };
  // Required fields complain only after a save was tried; a value already
  // typed in the wrong shape complains at once.
  const shown = (key: keyof typeof errors, value: string) => (tried || value ? (errors[key] ?? undefined) : undefined);
  const valid = Object.values(errors).every((e) => e === null);

  // What may change on this stand right now. A running job freezes the mode,
  // the layout and the path; orders on the stand freeze the layout and the
  // path, and keep it in deploy until they are gone.
  const job = !!stand?.job;
  const locked = !!stand?.locked;
  const modeFrozen = job || (locked && stand?.mode === "deploy");
  const gitFrozen = job || locked;
  // A running job is said once, above the form; the fields below only say what
  // holds them on their own.
  const modeNote = !job && modeFrozen ? t.deployLeaveHint : modeOf(d.mode).hint;
  // Each Git field explains itself under its own label; a locked pair says why
  // once, under the first of them.
  const layoutNote = !job && locked ? t.lockedHint : layoutOf(d.layout).hint;
  const pathNote = gitFrozen ? undefined : t.pathHint;
  // A new mode on a stand with orders moves them in a job, asked for first.
  const startsJob = !!stand && locked && d.mode !== stand.mode;

  async function save() {
    setTried(true);
    if (!valid) return;
    if (startsJob && !confirmMode) {
      setConfirmMode(true);
      return;
    }
    await submit();
  }

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      if (stand) {
        await api.updateStand({ ...stand, ...n });
        onDone(startsJob ? t.jobStartedToast(n.name) : t.toastSaved(n.name));
      } else {
        await api.createStand(n);
        onDone(t.toastCreated(n.name));
      }
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <>
      <FormDialogShell
        isOpen={target !== null}
        onClose={onClose}
        maxWidth="max-w-2xl"
        icon={stand ? <IconSettings size={20} stroke={1.8} /> : <IconServer size={20} stroke={1.8} />}
        title={stand ? t.editTitle(stand.name) : t.addTitle}
        footer={(close) => (
          <>
            <Button variant="secondary" onPress={close} isDisabled={busy}>
              Отмена
            </Button>
            <Button variant="primary" onPress={save} isDisabled={busy || (tried && !valid)}>
              {busy ? t.submitBusy : stand ? t.editSubmit : t.addSubmit}
            </Button>
          </>
        )}
      >
        <form
          className="flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {err && <ErrorBox error={new Error(err)} />}
          {job && (
            <p className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-800">
              <IconLoader2 size={16} stroke={2} className="mt-0.5 shrink-0 animate-spin motion-reduce:animate-none" />
              {t.jobRunningHint}
            </p>
          )}

          <Group title={t.groupMain}>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label={t.nameAria}
                isRequired
                isDisabled={busy}
                value={d.name}
                onChange={set("name")}
                placeholder={t.namePlaceholder}
                errorText={shown("name", "")}
              />
              <TextField
                label={t.clusterAria}
                isRequired
                isDisabled={busy}
                value={d.cluster}
                onChange={set("cluster")}
                placeholder={t.clusterPlaceholder}
                description={t.clusterHint}
                errorText={shown("cluster", n.default_cluster)}
              />
            </div>
            <Select
              label={t.modeLabel}
              selectedKey={d.mode}
              onSelectionChange={set("mode")}
              options={MODES}
              isDisabled={busy || modeFrozen}
              description={modeNote}
            />
          </Group>

          <Group title={t.groupGit}>
            <Select
              label={t.layoutLabel}
              selectedKey={d.layout}
              onSelectionChange={set("layout")}
              options={LAYOUTS}
              isDisabled={busy || gitFrozen}
              description={layoutNote}
            />
            <TextField
              label={t.pathLabel}
              isRequired={!gitFrozen}
              isDisabled={busy || gitFrozen}
              value={d.path}
              onChange={set("path")}
              placeholder={t.pathPlaceholder}
              description={pathNote}
              errorText={shown("path", n.git_path)}
            />
            <TextField
              label={t.gitUrlLabel}
              isDisabled={busy}
              value={d.gitUrl}
              onChange={set("gitUrl")}
              placeholder={t.gitUrlPlaceholder}
              description={t.gitUrlHint}
              errorText={shown("gitUrl", n.git_url)}
            />
          </Group>

          <Group title={t.groupArgo}>
            <TextField
              label={t.registryLabel}
              isDisabled={busy}
              value={d.registry}
              onChange={set("registry")}
              placeholder={t.registryPlaceholder}
              description={t.registryHint}
              errorText={shown("registry", n.chart_registry)}
            />
            <TextField
              label={t.argoNsLabel}
              isDisabled={busy}
              value={d.argoNs}
              onChange={set("argoNs")}
              placeholder={t.argoNsPlaceholder}
              description={t.argoNsHint}
              errorText={shown("argoNs", n.argocd_namespace)}
            />
          </Group>

          {/* Enter in any field saves, the way a form does. */}
          <button type="submit" hidden />
        </form>
      </FormDialogShell>

      <ConfirmDialog
        isOpen={confirmMode}
        onOpenChange={setConfirmMode}
        title={t.modeLabel}
        message={t.modeChangeConfirm(modeOf(d.mode).label)}
        onConfirm={submit}
      />
    </>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-3 w-full border-b border-slate-100 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}
