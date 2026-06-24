import { useState } from "react";
import { Link, Outlet } from "react-router-dom";
import { api, HttpError } from "../api/client";
import type { Category, PublicationStatus } from "../api/types";
import { chartLabel, useCatalog } from "../app/CatalogContext";
import { useUser } from "../auth/UserContext";
import { Button, Card, ErrorBox, Spinner, TextField } from "../components/ui";
import { useAsync } from "../hooks/useAsync";

const STATUS_BADGE: Record<PublicationStatus, { label: string; cls: string }> = {
  DRAFT: { label: "Черновик", cls: "bg-gray-100 text-gray-600" },
  PENDING: { label: "На согласовании", cls: "bg-amber-50 text-amber-700" },
  APPROVED: { label: "Согласовано", cls: "bg-emerald-50 text-emerald-700" },
  REJECTED: { label: "Отклонено", cls: "bg-red-50 text-red-700" },
};

// AdminSection guards the platform-admin area and renders the active sub-page.
// Mirrors SecuritySection: a thin role gate around <Outlet/>; the sidebar drives
// navigation between the section's pages.
export function AdminSection() {
  const { user } = useUser();
  if (user?.role !== "admin") {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Раздел доступен только администраторам платформы.
      </div>
    );
  }
  return <Outlet />;
}

// AdminOverviewPage: landing of the admin section - a quick summary of what
// needs attention (pending approvals) plus jump-off links to the sub-pages.
export function AdminOverviewPage() {
  const { data: pubs, error, loading } = useAsync(() => api.listPublications(), []);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;

  const all = pubs ?? [];
  const pending = all.filter((p) => p.status === "PENDING").length;
  const published = all.filter((p) => !!p.approved_view_json).length;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Администрирование платформы</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Ждут согласования" value={pending} tone={pending > 0 ? "amber" : "default"} />
        <StatCard label="Опубликовано" value={published} />
        <StatCard label="Всего публикаций" value={all.length} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <QuickLink
          to="/admin/approvals"
          title="Согласование публикаций"
          desc="Очередь форм заказа, ожидающих решения."
        />
        <QuickLink to="/admin/status" title="Состояние платформы" desc="Интеграции, хранилища, фоновые циклы." />
        <QuickLink to="/admin/categories" title="Категории каталога" desc="Структура разделов каталога." />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "amber";
}) {
  const valueCls = tone === "amber" && value > 0 ? "text-amber-600" : "text-slate-800";
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-2xl font-semibold ${valueCls}`}>{value}</span>
    </Card>
  );
}

function QuickLink({ to, title, desc }: { to: string; title: string; desc: string }) {
  return (
    <Link
      to={to}
      className="rounded-lg border border-slate-200 bg-surface p-4 outline-none hover:border-brand-300 hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      <span className="block text-sm font-medium text-slate-800">{title}</span>
      <span className="mt-1 block text-xs text-slate-500">{desc}</span>
    </Link>
  );
}

// AdminApprovalsPage: review queue for publication forms. The decision is made
// on the manage page (which carries the diff and preview); this is the entry
// point that lists what awaits a decision.
export function AdminApprovalsPage() {
  const { data: pubs, error, loading } = useAsync(() => api.listPublications(), []);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;

  const pending = (pubs ?? []).filter((p) => p.status === "PENDING");
  const rest = (pubs ?? []).filter((p) => p.status !== "PENDING");

  const row = (p: NonNullable<typeof pubs>[number]) => {
    const st = STATUS_BADGE[p.status];
    return (
      <li key={p.id}>
        <Link
          to={`/catalog/${p.chart_project}/${p.chart_name}/manage`}
          className="flex items-center justify-between gap-3 rounded-md px-3 py-2 hover:bg-slate-50"
        >
          <span className="flex items-center gap-3">
            <span className="font-medium text-slate-800">{chartLabel(p.chart_name)}</span>
            <span className="text-xs text-slate-400">
              {p.chart_project}/{p.chart_name}
            </span>
          </span>
          <span className="flex items-center gap-2 text-xs">
            <span className="rounded bg-brand-50 px-2 py-0.5 text-brand-700">{p.owner_team}</span>
            <span className={`rounded px-2 py-0.5 ${st.cls}`}>{st.label}</span>
          </span>
        </Link>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Согласование публикаций</h1>
      <Card>
        <h2 className="mb-2 text-sm font-semibold text-slate-800">Очередь на согласование</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-gray-500">Нет публикаций, ожидающих решения.</p>
        ) : (
          <ul className="-mx-3 flex flex-col">{pending.map(row)}</ul>
        )}
        {rest.length > 0 && (
          <>
            <h2 className="mb-2 mt-4 text-sm font-semibold text-slate-800">Все публикации</h2>
            <ul className="-mx-3 flex flex-col">{rest.map(row)}</ul>
          </>
        )}
      </Card>
    </div>
  );
}

// AdminCategoriesPage: CRUD over catalog categories (the taxonomy the sidebar
// and catalog group charts by).
export function AdminCategoriesPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Категории каталога</h1>
      <CategoriesAdmin />
    </div>
  );
}

function CategoriesAdmin() {
  const { categories, reload } = useCatalog();
  const [draft, setDraft] = useState<Category>({ id: "", label: "", sort: 0 });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setErr(e instanceof HttpError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {categories.map((c) => (
          <CategoryRow key={c.id} category={c} busy={busy} run={run} />
        ))}
        {categories.length === 0 && <p className="text-sm text-gray-500">Категорий нет.</p>}
      </ul>
      <div className="flex items-end gap-2 border-t border-slate-100 pt-3">
        <TextField label="ID (slug)" value={draft.id} onChange={(v: string) => setDraft({ ...draft, id: v })} />
        <TextField
          label="Название"
          value={draft.label}
          onChange={(v: string) => setDraft({ ...draft, label: v })}
        />
        <TextField
          label="Порядок"
          value={String(draft.sort)}
          onChange={(v: string) => setDraft({ ...draft, sort: Number(v) || 0 })}
        />
        <Button
          variant="primary"
          isDisabled={busy || !draft.id.trim() || !draft.label.trim()}
          onPress={() =>
            run(() => api.createCategory({ ...draft, id: draft.id.trim(), label: draft.label.trim() })).then(
              () => setDraft({ id: "", label: "", sort: 0 }),
            )
          }
        >
          Добавить
        </Button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </Card>
  );
}

function CategoryRow({
  category,
  busy,
  run,
}: {
  category: Category;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [label, setLabel] = useState(category.label);
  const [sort, setSort] = useState(String(category.sort));
  const dirty = label !== category.label || Number(sort) !== category.sort;
  return (
    <li className="flex items-end gap-2">
      <span className="w-32 shrink-0 pb-2 text-sm text-slate-500">{category.id}</span>
      <TextField label="Название" hideLabel value={label} onChange={(v: string) => setLabel(v)} />
      <TextField label="Порядок" hideLabel value={sort} onChange={(v: string) => setSort(v)} />
      <Button
        isDisabled={busy || !dirty || !label.trim()}
        onPress={() => run(() => api.updateCategory({ id: category.id, label: label.trim(), sort: Number(sort) || 0 }))}
      >
        Сохранить
      </Button>
      <Button variant="danger" isDisabled={busy} onPress={() => run(() => api.deleteCategory(category.id))}>
        Удалить
      </Button>
    </li>
  );
}
