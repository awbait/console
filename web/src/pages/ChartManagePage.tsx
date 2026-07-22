import {
  IconAlertCircle,
  IconAlertTriangle,
  IconArrowNarrowRight,
  IconArrowRight,
  IconCategory,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconPencil,
  IconTag,
  IconUser,
  IconUsersGroup,
} from "@tabler/icons-react";
import { useState } from "react";
import {
  Button as AriaButton,
  Select as AriaSelect,
  Dialog,
  DialogTrigger,
  Heading,
  ListBox,
  ListBoxItem,
  Modal,
  ModalOverlay,
  Popover,
  SelectValue,
} from "react-aria-components";
import { Link, useParams } from "react-router-dom";
import { api, HttpError } from "../api/client";
import type { ChartPublication, PublicationStatus, PublicationVersion } from "../api/types";
import { AUTO_DISCOVERY_ACTOR, publisherLabel } from "../api/types";
import { chartLabel, useCatalog } from "../app/CatalogContext";
import { useToast } from "../app/ToastContext";
import { canModify, useUser } from "../auth/UserContext";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { FormErrors } from "../components/FormErrors";
import { Button, Card, Chip, ErrorBox, Select, Spinner, TextField } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { compareSemver } from "../lib/semver";

export const STATUS_LABELS: Record<
  PublicationStatus,
  { label: string; cls: string; Icon: typeof IconClock }
> = {
  DRAFT: { label: "Черновик", cls: "bg-gray-100 text-gray-600", Icon: IconPencil },
  PENDING: { label: "На согласовании", cls: "bg-amber-50 text-amber-700", Icon: IconClock },
  APPROVED: { label: "Согласовано", cls: "bg-emerald-50 text-emerald-700", Icon: IconCheck },
  REJECTED: { label: "Отклонено", cls: "bg-red-50 text-red-700", Icon: IconAlertCircle },
};

// Short availability/status hint for a version, used in the editor's version
// switcher dropdown: "рекомендуемая, в каталоге" / "черновик" / "".
export function versionHint(
  v: string,
  row: PublicationVersion | null | undefined,
  recommended: string,
): string {
  const parts: string[] = [];
  if (v === recommended) parts.push("рекомендуемая");
  if (row?.orderable) parts.push("в каталоге");
  else if (row) parts.push(STATUS_LABELS[row.status].label.toLowerCase());
  return parts.join(", ");
}

// Publication management overview: metadata (category, owner) + the versions
// table. Editing a version's view document lives on its own page
// (/catalog/:project/:name/manage/:version), linked from each table row.
export function ChartManagePage() {
  const { project = "", name = "" } = useParams();
  const { user } = useUser();

  // Full publication (list -> match by project: the API filter keys by name).
  const {
    data: pub,
    loading: pubLoading,
    error: pubError,
    reload: reloadPub,
  } = useAsync(
    () =>
      api
        .listPublications({ chart: name })
        .then((list) => list.find((p) => p.chart_project === project) ?? null),
    [project, name],
  );

  if (pubLoading && !pub) return <Spinner />;
  if (pubError && !pub) return <ErrorBox error={pubError} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Breadcrumbs
        items={[
          { label: "Чарты", to: "/catalog" },
          { label: `${project}/${name}`, to: `/catalog/${project}/${name}` },
          { label: "Управление" },
        ]}
      />
      {pub ? (
        <PublicationOverview pub={pub} reload={reloadPub} />
      ) : (
        <RegisterCard project={project} name={name} onCreated={reloadPub} />
      )}
      {!pub && user?.role !== "admin" && (user?.teams?.length ?? 0) === 0 && (
        <p className="text-sm text-gray-500">Публиковать чарты могут участники команд.</p>
      )}
    </div>
  );
}

// Register a chart in the catalog: category + owner team.
function RegisterCard({
  project,
  name,
  onCreated,
}: {
  project: string;
  name: string;
  onCreated: () => void;
}) {
  const { user } = useUser();
  const { categories, reload: reloadCatalog } = useCatalog();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [ownerTeam, setOwnerTeam] = useState<string | null>(user?.teams?.[0] ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isAdmin = user?.role === "admin";
  const teams = user?.teams ?? [];

  async function onCreate() {
    if (!categoryId || !ownerTeam) {
      setErr("Выберите категорию и группу-владельца.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.createPublication({
        chart: `${project}/${name}`,
        category_id: categoryId,
        owner_team: ownerTeam,
      });
      reloadCatalog();
      onCreated();
    } catch (e) {
      setErr(e instanceof HttpError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex max-w-lg flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold">Публикация чарта {chartLabel(name)}</h1>
        <p className="mt-1 text-sm text-gray-600">
          Зарегистрируйте чарт в каталоге: выберите категорию и группу, которая будет управлять
          публикацией. Ваше имя будет показано в карточке чарта.
        </p>
      </div>
      <Select
        label="Категория"
        isRequired
        selectedKey={categoryId}
        onSelectionChange={setCategoryId}
        options={categories.map((c) => ({ id: c.id, label: c.label }))}
      />
      {teams.length > 0 ? (
        <Select
          label="Группа-владелец"
          isRequired
          selectedKey={ownerTeam}
          onSelectionChange={setOwnerTeam}
          options={teams.map((t) => ({ id: t, label: t }))}
        />
      ) : isAdmin ? (
        <TextField
          label="Группа-владелец"
          value={ownerTeam ?? ""}
          onChange={(v: string) => setOwnerTeam(v)}
        />
      ) : null}
      {err && <FormErrors message={err} />}
      <div>
        <Button variant="primary" isDisabled={busy} onPress={onCreate}>
          Опубликовать
        </Button>
      </div>
    </Card>
  );
}

function PublicationOverview({ pub, reload }: { pub: ChartPublication; reload: () => void }) {
  const { user } = useUser();
  const { categories, reload: reloadCatalog } = useCatalog();
  const { success, error } = useToast();
  const project = pub.chart_project;
  const name = pub.chart_name;

  // Chart versions from Harbor + the stored per-version publication rows.
  const { data: chart } = useAsync(() => api.getChart(project, name), [project, name]);
  const { data: versions, reload: reloadVersions } = useAsync(
    () => api.listVersions(pub.id),
    [pub.id],
  );

  const isOwner = canModify(user, pub.owner_team);
  // Unclaimed auto-discovered draft: a team member may adopt it (take over
  // ownership). The server re-checks; created_by flips to the adopter on adopt,
  // hiding the card afterwards.
  const canAdopt =
    !isOwner && pub.created_by === AUTO_DISCOVERY_ACTOR && (user?.teams?.length ?? 0) > 0;
  // Metadata (category/owner) has its own publication-level approval FSM: it is
  // frozen only while the metadata change itself is under review.
  const metaPending = pub.status === "PENDING";
  const metaEditable = isOwner && !metaPending;
  const hasMetaDraft = !!pub.draft_category_id || !!pub.draft_owner_team;

  // Row action in flight, keyed "<kind>:<version>" so only one runs at a time.
  const [busy, setBusy] = useState<string | null>(null);

  const catLabel = (id: string) => categories.find((c) => c.id === id)?.label ?? id;
  const categoryLabel = catLabel(pub.category_id);
  const ownerOptions = [
    ...new Set(
      [...(user?.teams ?? []), pub.owner_team, pub.draft_owner_team].filter(Boolean) as string[],
    ),
  ];
  const recommended = pub.recommended_version ?? "";

  async function onMetaChange(patch: { category_id?: string; owner_team?: string }) {
    try {
      await api.updatePublication(pub.id, patch);
      reload();
      reloadCatalog();
    } catch (e) {
      error(e instanceof HttpError ? e.message : (e as Error).message);
    }
  }

  async function onSubmitMeta() {
    setBusy("meta");
    try {
      await api.submitPublication(pub.id);
      reload();
      success("Смена метаданных отправлена на согласование");
    } catch (e) {
      error(e instanceof HttpError ? e.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onWithdrawMeta() {
    setBusy("meta");
    try {
      await api.withdrawPublication(pub.id);
      reload();
    } catch (e) {
      error(e instanceof HttpError ? e.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onToggleOrderable(row: PublicationVersion) {
    setBusy(`orderable:${row.chart_version}`);
    try {
      await api.setVersionOrderable(pub.id, row.chart_version, !row.orderable);
      reloadVersions();
      reloadCatalog();
      success(row.orderable ? "Версия убрана из каталога" : "Версия доступна в каталоге");
    } catch (e) {
      error(e instanceof HttpError ? e.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onSetRecommended(v: string) {
    setBusy(`recommend:${v}`);
    try {
      await api.setRecommendedVersion(pub.id, v);
      reload();
      reloadCatalog();
      success(`Версия ${v} помечена рекомендуемой`);
    } catch (e) {
      error(e instanceof HttpError ? e.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // Harbor returns versions in push order; the table sorts them by semver,
  // highest first (a re-pushed old version must not float to the top). Stored
  // rows whose chart version is gone from Harbor follow, same order.
  const harborVersions = [...(chart?.versions ?? [])].sort((a, b) => compareSemver(b, a));
  const orphanRows = (versions ?? [])
    .filter((r) => !harborVersions.includes(r.chart_version))
    .sort((a, b) => compareSemver(b.chart_version, a.chart_version));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Управление: {chartLabel(name)}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {metaEditable ? (
            <ChipSelect
              label="Категория"
              icon={<IconCategory size={13} stroke={1.8} className="text-slate-400" />}
              value={pub.draft_category_id || pub.category_id}
              pending={!!pub.draft_category_id}
              options={categories.map((c) => ({ id: c.id, label: c.label }))}
              onChange={(id) => onMetaChange({ category_id: id })}
              info="Категория изменится только после согласования"
            />
          ) : pub.draft_category_id ? (
            <ProposalChip
              label="Категория"
              from={categoryLabel}
              to={catLabel(pub.draft_category_id)}
            />
          ) : (
            <Chip className="bg-slate-100 text-slate-600">
              <IconCategory size={13} stroke={1.8} className="text-slate-400" />
              <span className="text-slate-400">Категория:</span>
              {categoryLabel}
            </Chip>
          )}
          {metaEditable && ownerOptions.length > 1 ? (
            <ChipSelect
              label="Владелец"
              icon={<IconUsersGroup size={13} stroke={1.8} className="text-slate-400" />}
              value={pub.draft_owner_team || pub.owner_team}
              pending={!!pub.draft_owner_team}
              options={ownerOptions.map((t) => ({ id: t, label: t }))}
              onChange={(t) => onMetaChange({ owner_team: t })}
              info="Владелец изменится только после согласования"
            />
          ) : pub.draft_owner_team ? (
            <ProposalChip label="Владелец" from={pub.owner_team} to={pub.draft_owner_team} />
          ) : (
            <Chip className="bg-brand-50 text-brand-700">
              <IconUsersGroup size={13} stroke={1.8} className="text-brand-400" />
              <span className="text-brand-400">Владелец:</span>
              {pub.owner_team}
            </Chip>
          )}
          {pub.created_by_name && (
            <Chip className="bg-slate-100 text-slate-600">
              <IconUser size={13} stroke={1.8} className="text-slate-400" />
              <span className="text-slate-400">{publisherLabel(pub.created_by)}:</span>
              {pub.created_by_name}
            </Chip>
          )}
        </div>
      </div>

      {canAdopt && <AdoptCard pub={pub} onAdopted={reload} />}

      {/* Metadata (category/owner) change has its own approval flow. */}
      {metaPending ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>Смена метаданных (категория/владелец) на согласовании у администратора.</span>
          {isOwner && (
            <Button isDisabled={busy !== null} onPress={onWithdrawMeta}>
              Отозвать
            </Button>
          )}
        </div>
      ) : (
        hasMetaDraft &&
        isOwner && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <span>Есть несогласованные изменения метаданных (категория/владелец).</span>
            <Button variant="primary" isDisabled={busy !== null} onPress={onSubmitMeta}>
              Отправить метаданные на согласование
            </Button>
          </div>
        )
      )}

      {/* Versions: one row per chart version, per-version status + availability.
          Editing a version's view opens its own page (deep-linkable). */}
      {!chart && versions === null ? (
        <Spinner />
      ) : harborVersions.length === 0 && orphanRows.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-surface py-10 text-center text-sm text-slate-500 shadow-sm">
          Версии чарта не найдены в Harbor.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-2.5 font-medium">Версия</th>
                <th className="px-4 py-2.5 font-medium">Статус</th>
                <th className="px-4 py-2.5 font-medium">В каталоге</th>
                <th className="px-4 py-2.5 text-right font-medium">Действия</th>
              </tr>
            </thead>
            <tbody>
              {harborVersions.map((v) => (
                <VersionRow
                  key={v}
                  version={v}
                  row={versions?.find((r) => r.chart_version === v) ?? null}
                  recommended={recommended === v}
                  isOwner={isOwner}
                  busy={busy}
                  basePath={`/catalog/${project}/${name}/manage`}
                  onToggleOrderable={onToggleOrderable}
                  onSetRecommended={onSetRecommended}
                />
              ))}
              {orphanRows.map((r) => (
                <VersionRow
                  key={r.chart_version}
                  version={r.chart_version}
                  row={r}
                  missing
                  recommended={recommended === r.chart_version}
                  isOwner={isOwner}
                  busy={busy}
                  basePath={`/catalog/${project}/${name}/manage`}
                  onToggleOrderable={onToggleOrderable}
                  onSetRecommended={onSetRecommended}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// AdoptCard claims an unclaimed auto-discovered publication: the chart was
// registered by the Harbor scan and has no real owner yet, any team member can
// take it over by picking a category and their owner group.
function AdoptCard({ pub, onAdopted }: { pub: ChartPublication; onAdopted: () => void }) {
  const { user } = useUser();
  const { categories, reload: reloadCatalog } = useCatalog();
  const { success, error } = useToast();
  const teams = user?.teams ?? [];
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [ownerTeam, setOwnerTeam] = useState<string | null>(teams[0] ?? null);
  const [busy, setBusy] = useState(false);

  async function onAdopt() {
    if (!categoryId || !ownerTeam) {
      error("Выберите категорию и группу-владельца.");
      return;
    }
    setBusy(true);
    try {
      await api.adoptPublication(pub.id, { category_id: categoryId, owner_team: ownerTeam });
      reloadCatalog();
      onAdopted();
      success(`Чарт теперь сопровождает группа ${ownerTeam}`);
    } catch (e) {
      error(e instanceof HttpError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 border-brand-200 bg-brand-50/40">
      <div>
        <h2 className="text-sm font-semibold text-slate-800">Чарт никем не сопровождается</h2>
        <p className="mt-1 text-sm text-slate-600">
          Публикация создана автоматически при сканировании Harbor. Возьмите чарт в работу: ваша
          группа станет владельцем и сможет настраивать формы заказа и публиковать версии.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Select
            label="Категория"
            isRequired
            selectedKey={categoryId}
            onSelectionChange={setCategoryId}
            options={categories.map((c) => ({ id: c.id, label: c.label }))}
          />
        </div>
        <div className="w-56">
          <Select
            label="Группа-владелец"
            isRequired
            selectedKey={ownerTeam}
            onSelectionChange={setOwnerTeam}
            options={teams.map((t) => ({ id: t, label: t }))}
          />
        </div>
        <Button variant="primary" isDisabled={busy} onPress={onAdopt}>
          Взять в работу
        </Button>
      </div>
    </Card>
  );
}

// One version row: status, availability and compact row actions. The edit link
// deep-links to the version's own editor page.
function VersionRow({
  version,
  row,
  missing = false,
  recommended,
  isOwner,
  busy,
  basePath,
  onToggleOrderable,
  onSetRecommended,
}: {
  version: string;
  row: PublicationVersion | null;
  missing?: boolean;
  recommended: boolean;
  isOwner: boolean;
  busy: string | null;
  basePath: string;
  onToggleOrderable: (row: PublicationVersion) => void;
  onSetRecommended: (v: string) => void;
}) {
  const st = row ? STATUS_LABELS[row.status] : null;
  const canToggleOrderable =
    isOwner && !!row && row.status === "APPROVED" && !!row.approved_view_json;
  const canRecommend =
    isOwner && !!row && row.orderable && row.status === "APPROVED" && !recommended;

  return (
    <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
      <td className="px-4 py-3">
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[13px] font-medium text-slate-800">{version}</span>
          {recommended && (
            <Chip className="bg-brand-50 text-brand-700">
              <IconTag size={12} stroke={2} />
              Рекомендуемая
            </Chip>
          )}
          {missing && (
            <span
              className="inline-flex items-center gap-1 text-xs text-amber-600"
              title="Версии больше нет в Harbor"
            >
              <IconAlertTriangle size={13} stroke={1.8} />
              нет в Harbor
            </span>
          )}
        </span>
      </td>
      <td className="px-4 py-3">
        {!st || !row ? (
          <span className="text-xs text-slate-400">не настроена</span>
        ) : row.status === "REJECTED" && row.review_comment ? (
          <RejectedChip comment={row.review_comment} />
        ) : (
          <Chip className={st.cls}>
            <st.Icon size={13} stroke={1.8} />
            {st.label}
          </Chip>
        )}
      </td>
      <td className="px-4 py-3">
        {row?.orderable ? (
          <Chip className="bg-emerald-50 text-emerald-700">
            <IconCheck size={12} stroke={2.5} />
            Да
          </Chip>
        ) : (
          <span className="text-xs text-slate-300">-</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {canRecommend && (
            <RowAction
              isDisabled={busy !== null}
              onPress={() => onSetRecommended(version)}
            >
              Рекомендовать
            </RowAction>
          )}
          {canToggleOrderable && row && (
            <RowAction isDisabled={busy !== null} onPress={() => onToggleOrderable(row)}>
              {row.orderable ? "Убрать из каталога" : "В каталог"}
            </RowAction>
          )}
          <Link
            to={`${basePath}/${encodeURIComponent(version)}`}
            className="inline-flex items-center gap-1 rounded-md border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 outline-none transition-colors hover:bg-brand-100 focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {isOwner ? (row ? "Изменить" : "Настроить") : "Открыть"}
            <IconArrowRight size={14} stroke={1.8} />
          </Link>
        </div>
      </td>
    </tr>
  );
}

// Compact secondary action for a table row (smaller than the shared Button).
function RowAction({
  children,
  onPress,
  isDisabled,
}: {
  children: React.ReactNode;
  onPress: () => void;
  isDisabled?: boolean;
}) {
  return (
    <AriaButton
      onPress={onPress}
      isDisabled={isDisabled}
      className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-200 bg-surface px-2.5 py-1 text-xs font-medium text-slate-600 outline-none transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-default disabled:opacity-50"
    >
      {children}
    </AriaButton>
  );
}

// Rejected status chip: clickable, the review comment opens in a modal.
export function RejectedChip({ comment }: { comment: string }) {
  const st = STATUS_LABELS.REJECTED;
  return (
    <DialogTrigger>
      <AriaButton
        className={`inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium outline-none transition-[filter] hover:brightness-95 focus-visible:ring-2 focus-visible:ring-brand-500 ${st.cls}`}
      >
        <st.Icon size={13} stroke={1.8} />
        {st.label}
      </AriaButton>
      <ModalOverlay
        isDismissable
        className="fixed inset-0 z-10 flex items-start justify-center bg-black/20 p-4 pt-24 entering:animate-in entering:fade-in"
      >
        <Modal className="w-full max-w-lg rounded-lg border border-slate-200 bg-surface shadow-xl">
          <Dialog className="outline-none">
            {({ close }) => (
              <div className="flex flex-col items-center gap-3 p-5 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-500">
                  <IconAlertCircle size={26} stroke={1.8} />
                </span>
                <Heading slot="title" className="text-base font-semibold text-slate-800">
                  Версия отклонена
                </Heading>
                <p className="text-sm text-slate-600">
                  Администратор отклонил черновик версии. Причина:
                </p>
                <p className="w-full whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm text-slate-700">
                  {comment}
                </p>
                <Button onPress={close}>Понятно</Button>
              </div>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}

// ProposalChip, an amber chip "was -> now (under review)": shows an unapproved
// category/owner change where editing is not available.
function ProposalChip({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <Chip className="bg-amber-50 text-amber-700">
      <IconClock size={12} stroke={2} className="text-amber-500" aria-hidden />
      <span className="font-normal text-amber-500">{label}:</span>
      <span className="text-amber-600/70 line-through">{from}</span>
      <IconArrowNarrowRight size={13} stroke={2} className="text-amber-400" aria-hidden />
      {to}
    </Chip>
  );
}

// ChipSelect, a select shaped like a chip: compact category/owner editing right
// in the header, without a separate metadata card. pending tints the chip amber:
// the selected value is a proposal, it becomes active only after approval.
export function ChipSelect({
  label,
  icon,
  value,
  options,
  onChange,
  pending = false,
  info,
}: {
  label: string;
  icon?: React.ReactNode;
  value: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
  pending?: boolean;
  info?: string;
}) {
  const tone = pending
    ? "bg-amber-50 text-amber-700 hover:bg-amber-100 data-[pressed]:bg-amber-100"
    : "bg-slate-100 text-slate-600 hover:bg-slate-200 data-[pressed]:bg-slate-200";
  return (
    <AriaSelect
      selectedKey={value}
      onSelectionChange={(k) => k !== value && onChange(String(k))}
      aria-label={label}
      className="inline-flex"
    >
      <AriaButton
        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 ${tone}`}
      >
        {!pending && icon}
        {pending && (
          <span className="group/clock relative inline-flex">
            <IconClock size={12} stroke={2} className="text-amber-500" aria-hidden />
            {info && (
              <span
                role="tooltip"
                className="pointer-events-none invisible absolute bottom-full left-1/2 z-20 mb-1.5 w-max max-w-xs -translate-x-1/2 rounded-md border border-slate-200 bg-surface px-2.5 py-1.5 text-xs font-normal text-slate-700 opacity-0 shadow-lg transition-opacity duration-150 group-hover/clock:visible group-hover/clock:opacity-100"
              >
                {info}
              </span>
            )}
          </span>
        )}
        <span className={`font-normal ${pending ? "text-amber-500" : "text-slate-400"}`}>
          {label}:
        </span>
        <SelectValue />
        <IconChevronDown
          size={12}
          stroke={2}
          className={pending ? "text-amber-500" : "text-slate-400"}
          aria-hidden
        />
      </AriaButton>
      <Popover className="min-w-[var(--trigger-width)] rounded-md border border-slate-200 bg-surface shadow-lg entering:animate-in entering:fade-in">
        <ListBox className="max-h-60 overflow-auto p-1 outline-none">
          {options.map((o) => (
            <ListBoxItem
              key={o.id}
              id={o.id}
              className="cursor-pointer rounded px-2 py-1 text-xs outline-none focus:bg-brand-50 selected:bg-brand-100"
            >
              {o.label}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
}
