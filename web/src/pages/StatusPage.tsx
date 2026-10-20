import {
  IconAlertTriangle,
  IconCircleCheck,
  IconDatabase,
  IconExternalLink,
  IconPlugConnected,
  IconRefresh,
  IconRepeat,
  IconSettings,
  IconUsers,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { CapabilityStatus, ComponentStatus, ReconcilerStatus, StandChecksSummary } from "../api/types";
import { capabilityText } from "../app/capabilities";
import { useUser } from "../auth/UserContext";
import { Page, PageBody } from "../components/Page";
import { PageHeader } from "../components/PageHeader";
import { Button, buttonClass, ErrorBox, SkeletonRows, StatusPill } from "../components/ui";
import { maintenanceText } from "../features/maintenance/text";
import { standText } from "../features/stands/text";
import { useAsync } from "../hooks/useAsync";
import { safeHref } from "../lib/href";

// Status auto-refresh interval, seconds.
const REFRESH_SECONDS = 30;

// Integration names as their vendors write them.
const COMPONENT_LABELS: Record<string, string> = {
  keycloak: "Keycloak",
  harbor: "Harbor",
  gitlab: "GitLab",
  argocd: "Argo CD",
};

// What each component does for the portal. An admin opening this page during an
// incident should not have to remember which system holds what.
const COMPONENT_ROLE: Record<string, string> = {
  keycloak: "Вход в портал и группы пользователей",
  harbor: "Реестр чартов: каталог, версии и формы заказа",
  gitlab: "Репозитории и merge request заказов",
  argocd: "Выкатка заказов в кластер и их состояние",
  store: "База портала: заказы, публикации, категории",
  cache: "Кеш: ускоряет выдачу файлов чартов",
};

// Storage rows are titled by their backend.
const BACKEND_LABELS: Record<string, string> = {
  postgres: "PostgreSQL",
  redis: "Redis",
  memory: "В памяти процесса",
};

// The background loops, in terms of what they do. "Reconciler" is an
// implementation word; the page says what stops happening if one of them fails.
const RECONCILERS: Record<string, { label: string; what: string }> = {
  provisioning: {
    label: "Проведение заказов",
    what: "Продвигает заказы по этапам: merge request, слияние, выкатка, готовность.",
  },
  drift: {
    label: "Контроль изменений в Git",
    what: "Замечает правки, внесённые в Git мимо портала, и отмечает такие заказы.",
  },
  import: {
    label: "Импорт из Git",
    what: "Находит сервисы, заведённые в Git напрямую, и добавляет их в список заказов.",
  },
  "catalog-discovery": {
    label: "Поиск сервисов в реестре",
    what: "Ищет в реестре новые чарты и заводит для них черновики публикаций.",
  },
  "chart-versions": {
    label: "Новые версии сервисов",
    what: "Замечает в реестре версии, которых ещё нет в каталоге, и сообщает о них владельцам сервиса.",
  },
  "notification-sweep": {
    label: "Уборка уведомлений",
    what: "Удаляет старые прочитанные уведомления, непрочитанные остаются.",
  },
  "deleted-orders-sweep": {
    label: "Очистка удалённых заказов",
    what: "Окончательно удаляет заказы и выброшенные черновики вместе с историей, когда истекает срок хранения.",
  },
  "stand-checks": {
    label: "Проверка стендов",
    what: "Проверяет доступ к пути в GitLab, кластеры и видимость приложений стендов в Argo CD и сохраняет результаты.",
  },
  "stand-jobs": {
    label: "Перевод заказов",
    what: "Переводит существующие заказы в новый режим стенда по несколько заказов за проход и сохраняет результаты.",
  },
};

// A stand's worst verdict, in the words of the stand page's own rows.
const STAND_VERDICT: Record<string, { ok: boolean; label: string }> = {
  ok: { ok: true, label: "В норме" },
  skip: { ok: true, label: "В норме" },
  warn: { ok: false, label: "Есть замечания" },
  fail: { ok: false, label: "Есть проблемы" },
  unknown: { ok: false, label: "Не проверен" },
};

const STAND_MODE: Record<string, string> = {
  deploy: standText.modeDeploy,
  git: standText.modeGit,
  console: standText.modeConsole,
};

// ago renders a coarse "N units назад" from an RFC3339 timestamp.
function ago(iso?: string): string {
  if (!iso) return "ещё не выполнялась";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s} сек назад`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч назад`;
  return `${Math.round(h / 24)} дн назад`;
}

// count returns how many of a list are not ok, and how many there are.
function tally<T>(items: T[], ok: (x: T) => boolean): { ok: number; total: number; broken: number } {
  const good = items.filter(ok).length;
  return { ok: good, total: items.length, broken: items.length - good };
}

export function StatusPage() {
  const { user } = useUser();
  const { data, error, loading, reload } = useAsync(() => api.getSystemStatus(), []);
  // The stands' stored checks ride the same refresh: the background round
  // writes them, this page only reads.
  const standsChecks = useAsync((signal) => api.standChecksSummary(signal), []);

  // Auto-refresh: status is live, keep the page fresh without manual reload.
  useEffect(() => {
    const t = setInterval(() => {
      reload();
      standsChecks.reload();
    }, REFRESH_SECONDS * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // System status is a platform-admin tool (the sidebar entry is hidden for
  // others; this guards a direct URL visit too).
  if (user?.role !== "admin") {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Раздел доступен только администраторам платформы.
      </div>
    );
  }

  const components = data?.components ?? [];
  const integrations = components.filter((c) => c.kind === "integration");
  const storage = components.filter((c) => c.kind === "storage");
  const capabilities = data?.capabilities ?? [];
  const reconcilers = data?.reconcilers ?? [];
  // One replica of the portal runs the background tasks. Until an answer
  // arrives we assume this is it, so the page never mentions another replica
  // before it knows there is more than one.
  const leading = data?.leader ?? true;

  const capCount = tally(capabilities, (c) => c.ok);
  const intCount = tally(integrations, (c) => c.status === "ok");
  const stoCount = tally(storage, (c) => c.status === "ok");
  const loopCount = tally(reconcilers, (r) => r.status === "ok");

  return (
    // The page stays within the viewport: the header keeps its place and only
    // the sections below it scroll, so the verdict and the refresh button are
    // still there after scrolling down to a failing component.
    <Page>
      <PageHeader
        title="Состояние платформы"
        status={
          data &&
          (data.healthy ? (
            <StatusPill tone="bg-emerald-50 text-emerald-700" Icon={IconCircleCheck}>
              Всё работает
            </StatusPill>
          ) : (
            <StatusPill tone="bg-amber-50 text-amber-700" Icon={IconAlertTriangle}>
              Есть проблемы
            </StatusPill>
          ))
        }
        actions={
          <>
            <span className="hidden text-xs text-slate-400 sm:inline">
              обновляется каждые {REFRESH_SECONDS} сек
            </span>
            {safeHref(data?.grafana_url) && (
              <a
                href={safeHref(data?.grafana_url)}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass("secondary", "gap-1.5")}
              >
                Графики в Grafana
                <IconExternalLink size={14} stroke={1.8} />
              </a>
            )}
            <Button variant="secondary" onPress={reload} isDisabled={loading} className="gap-1.5">
              <IconRefresh size={16} stroke={1.8} className="text-slate-400" />
              {loading ? "Обновляем…" : "Обновить"}
            </Button>
          </>
        }
      />

      <PageBody>
        {loading && !data ? (
          <SkeletonRows rows={6} />
        ) : error ? (
          <ErrorBox error={error} onRetry={reload} />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Tile
                label="Возможности портала"
                count={capCount}
                caption={
                  capCount.broken === 0 ? "доступны пользователям" : "недоступны пользователям"
                }
                Icon={IconUsers}
              />
              <Tile
                label="Интеграции"
                count={intCount}
                caption="внешних систем отвечают"
                Icon={IconPlugConnected}
              />
              <Tile
                label="Хранилища"
                count={stoCount}
                caption="база и кеш отвечают"
                Icon={IconDatabase}
              />
              <Tile
                label="Фоновые задачи"
                count={loopCount}
                caption={
                  !leading
                    ? "их выполняет другая реплика"
                    : loopCount.broken === 0
                      ? "выполняются штатно"
                      : "со сбоями"
                }
                Icon={IconRepeat}
              />
            </div>

            <Section
              title="Что доступно пользователям"
              hint="Итог для тех, кто работает с порталом: что можно делать прямо сейчас. То же самое видит пользователь по значку состояния в верхней панели."
            >
              <Grid cols={3}>
                {capabilities.map((c) => (
                  <CapabilityCard key={c.id} cap={c} />
                ))}
              </Grid>
            </Section>

            <Section
              title="Интеграции"
              hint="Внешние системы, на которых работает портал. Портал опрашивает их сам, в фоне."
            >
              <Grid cols={2}>
                {integrations.map((c) => (
                  <ComponentCard key={c.name} c={c} />
                ))}
              </Grid>
            </Section>

            <ChecksLine />

            <Section title={standText.statusSectionTitle} hint={standText.statusSectionHint}>
              {standsChecks.error ? (
                <ErrorBox error={standsChecks.error} onRetry={standsChecks.reload} />
              ) : standsChecks.loading && !standsChecks.data ? (
                <SkeletonRows rows={2} />
              ) : (
                <Grid cols={2}>
                  {(standsChecks.data?.stands ?? []).map((s) => (
                    <StandCard key={s.stand.id} s={s} />
                  ))}
                </Grid>
              )}
            </Section>

            <Section title="Хранилища" hint="База данных портала и кеш.">
              <Grid cols={2}>
                {storage.map((c) => (
                  <ComponentCard key={c.name} c={c} />
                ))}
              </Grid>
            </Section>

            <Section
              title="Фоновые задачи"
              hint="Портал работает не только на запросы пользователей: эти задачи повторяются сами и держат данные в актуальном виде. История запусков и графики - в Grafana."
            >
              {leading ? (
                <Grid cols={2}>
                  {reconcilers.map((r) => (
                    <ReconcilerCard key={r.name} r={r} />
                  ))}
                </Grid>
              ) : (
                // The tasks run on one replica and this page was opened on
                // another. An empty list would read as "nothing is running", so
                // it is replaced by the reason there is nothing to list.
                <p className="rounded-lg border border-slate-200 bg-surface p-4 text-sm text-slate-500 shadow-sm">
                  Эти задачи сейчас выполняет другая реплика портала. Их состояние показывает она,
                  а сводка по всем репликам есть в Grafana.
                </p>
              )}
            </Section>
          </>
        )}
      </PageBody>
    </Page>
  );
}

// Grid keeps the page filling its column without stretching a card to the width
// of a wide screen: two or three per row, one on a narrow one.
function Grid({ cols, children }: { cols: 2 | 3; children: ReactNode }) {
  return (
    <div
      className={`grid grid-cols-1 gap-3 md:grid-cols-2 ${cols === 3 ? "xl:grid-cols-3" : ""}`}
    >
      {children}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      <p className="mb-3 mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">{hint}</p>
      {children}
    </section>
  );
}

function Tile({
  label,
  count,
  caption,
  Icon,
}: {
  label: string;
  count: { ok: number; total: number; broken: number };
  caption: string;
  Icon: typeof IconUsers;
}) {
  const ok = count.broken === 0;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-surface p-4 shadow-sm">
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
          ok ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
        }`}
      >
        <Icon size={20} stroke={1.8} />
      </span>
      <div className="min-w-0">
        <div className="text-lg font-semibold leading-tight text-slate-900">
          {ok ? count.total : `${count.broken} из ${count.total}`}
        </div>
        <div className="truncate text-xs font-medium text-slate-700">{label}</div>
        <div className="truncate text-xs text-slate-400">{caption}</div>
      </div>
    </div>
  );
}

// Card is the frame every row on this page shares: a status dot, a title, a
// verdict on the right, and room for the detail below.
function Card({
  ok,
  title,
  verdict,
  children,
}: {
  ok: boolean;
  title: ReactNode;
  verdict: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 bg-surface p-4 shadow-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 shrink-0 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`}
          />
          <span className="truncate font-medium text-slate-800">{title}</span>
        </div>
        <div className="pl-4">{children}</div>
      </div>
      <span className={`shrink-0 text-sm font-medium ${ok ? "text-emerald-600" : "text-amber-600"}`}>
        {verdict}
      </span>
    </div>
  );
}

function CapabilityCard({ cap }: { cap: CapabilityStatus }) {
  const text = capabilityText(cap.id);
  return (
    <Card ok={cap.ok} title={text.label} verdict={cap.ok ? "Доступно" : "Недоступно"}>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        {cap.ok ? "Работает как обычно." : text.impact}
      </p>
    </Card>
  );
}

function ComponentCard({ c }: { c: ComponentStatus }) {
  const ok = c.status === "ok";
  const title =
    c.kind === "storage" ? (BACKEND_LABELS[c.mode] ?? c.mode) : (COMPONENT_LABELS[c.name] ?? c.name);
  return (
    <Card ok={ok} title={title} verdict={ok ? "Отвечает" : "Не отвечает"}>
      {COMPONENT_ROLE[c.name] && (
        <p className="mt-1 text-xs leading-relaxed text-slate-500">{COMPONENT_ROLE[c.name]}</p>
      )}
      {safeHref(c.url) && (
        <a
          href={safeHref(c.url)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-flex min-w-0 max-w-full items-center gap-1 truncate text-xs text-brand-600 hover:text-brand-700 hover:underline"
        >
          {c.url}
          <IconExternalLink size={12} stroke={1.8} className="shrink-0" />
        </a>
      )}
      {!ok && c.detail && <Detail text={c.detail} />}
    </Card>
  );
}

function ReconcilerCard({ r }: { r: ReconcilerStatus }) {
  const ok = r.status === "ok";
  // Held by maintenance: not broken, but not working either, so it keeps the
  // attention colour and says why in its own words.
  const paused = r.status === "paused";
  const meta = RECONCILERS[r.name];
  return (
    <Card
      ok={ok}
      title={meta?.label ?? r.name}
      verdict={ok ? "В норме" : paused ? maintenanceText.reconcilerPaused : "Сбой"}
    >
      {meta && <p className="mt-1 text-xs leading-relaxed text-slate-500">{meta.what}</p>}
      {paused && <p className="mt-1 text-xs font-medium text-amber-700">{maintenanceText.reconcilerPausedNote}</p>}
      <p className="mt-1.5 text-xs text-slate-400">
        последний успешный запуск: {ago(r.last_success)}
        {r.last_run_ms ? ` · ${r.last_run_ms} мс` : ""}
      </p>
      {!ok && !paused && r.last_error && <Detail text={r.last_error} />}
    </Card>
  );
}

// StandCard is one stand as the status page sums it up: the worst of its
// stored verdicts, whether Argo CD is wired to it, when it was last looked at,
// and the way to its own page, where the verdicts are spelled out.
function StandCard({ s }: { s: StandChecksSummary }) {
  const v = STAND_VERDICT[s.worst] ?? STAND_VERDICT.unknown;
  const st = s.stand;
  const deploying = !st.mode || st.mode === "deploy";
  return (
    <Card ok={v.ok} title={st.name} verdict={v.label}>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        {STAND_MODE[st.mode] ?? st.mode}
        {deploying && (
          <>
            {" · "}
            <span className={st.argo_connected ? "" : "font-medium text-amber-700"}>
              {st.argo_connected ? standText.argoConnected : standText.argoNotConnected}
            </span>
          </>
        )}
      </p>
      <p className="mt-1.5 text-xs text-slate-400">
        {st.checked_at ? standText.checkedAgo(ago(st.checked_at)) : standText.neverChecked}
      </p>
      <Link
        to={`/admin/stands/${st.id}`}
        className="mt-1.5 inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 hover:underline"
      >
        {standText.openPage}
        <IconExternalLink size={12} stroke={1.8} />
      </Link>
    </Card>
  );
}

// ChecksLine is all this page says about configuration: whether anything needs
// doing, and where to go and do it. The verdicts themselves live next to the
// settings they are about, on the configuration page, because that is where a
// person is when they can act on them.
function ChecksLine() {
  const { data } = useAsync(() => api.getStatusChecks(), []);
  if (!data?.checked_at) return null;
  const problems = data.results.filter((c) => c.verdict === "fail" || c.verdict === "warn").length;
  return (
    <Link
      to="/admin/config"
      className={`flex items-center justify-between gap-3 rounded-lg border p-4 text-sm shadow-sm transition-colors ${
        problems === 0
          ? "border-slate-200 bg-surface text-slate-600 hover:bg-slate-50"
          : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <IconSettings size={16} stroke={1.8} className="shrink-0 opacity-70" />
        {problems === 0
          ? "Настройка платформы в порядке."
          : `Настройка платформы: требуют внимания ${problems} из ${data.results.length}.`}
      </span>
      <span className="shrink-0 text-xs font-medium underline-offset-2 group-hover:underline">
        Открыть конфигурацию
      </span>
    </Link>
  );
}

// Detail is the raw failure, kept apart from the product wording: monospaced,
// wrapped, and clearly a machine's words rather than the page's.
function Detail({ text }: { text: string }) {
  return (
    <p className="mt-2 break-words rounded bg-red-50 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-red-700">
      {text}
    </p>
  );
}
