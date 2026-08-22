import {
  IconAlertTriangle,
  IconCircleCheck,
  IconDatabase,
  IconExternalLink,
  IconPlugConnected,
  IconRefresh,
  IconRepeat,
  IconSend,
  IconUsers,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../api/client";
import type {
  CapabilityStatus,
  ComponentStatus,
  ConfigCheck,
  DeliveryTest,
  ReconcilerStatus,
} from "../api/types";
import { capabilityText } from "../app/capabilities";
import {
  checkReason,
  checkText,
  deliveryOutcomeText,
  factLabel,
  factValue,
  verdictLabel,
} from "../app/configChecks";
import { useUser } from "../auth/UserContext";
import { Button, buttonClass, ErrorBox, SkeletonRows } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { safeHref } from "../lib/href";

// Status auto-refresh interval, seconds.
const REFRESH_SECONDS = 30;

// The configuration checks refresh on their own far more slowly: a round costs
// the upstreams a handful of API calls and answers a question that only changes
// when somebody deploys. The backend runs them on its own schedule; this is just
// how often the page re-reads the answer.
const CHECKS_REFRESH_MS = 60_000;

// While a round is in flight the page keeps asking, so pressing "проверить
// сейчас" shows the new answer rather than the previous one.
const CHECKS_POLL_MS = 2_000;

// Components the checks are grouped under, in reading order: the portal's own
// settings first, then the systems it talks to.
const CHECK_GROUPS: { id: string; title: string }[] = [
  { id: "portal", title: "Портал" },
  { id: "gitlab", title: "GitLab" },
  { id: "harbor", title: "Harbor" },
  { id: "argocd", title: "Argo CD" },
  { id: "keycloak", title: "Keycloak" },
];

// Colours per verdict. Ok and problems read like the rest of the page; "не
// проверено" and "не используется" are deliberately quiet - they are not news.
const VERDICT_TONE: Record<string, { dot: string; text: string }> = {
  ok: { dot: "bg-emerald-500", text: "text-emerald-600" },
  warn: { dot: "bg-amber-500", text: "text-amber-600" },
  fail: { dot: "bg-red-500", text: "text-red-600" },
  skip: { dot: "bg-slate-300", text: "text-slate-400" },
  unknown: { dot: "bg-slate-300", text: "text-slate-400" },
};

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
  "argocd-fake": {
    label: "Argo CD (заглушка)",
    what: "Имитирует выкатку, чтобы портал работал без настоящего Argo CD.",
  },
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

  // Auto-refresh: status is live, keep the page fresh without manual reload.
  useEffect(() => {
    const t = setInterval(reload, REFRESH_SECONDS * 1000);
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

  const capCount = tally(capabilities, (c) => c.ok);
  const intCount = tally(integrations, (c) => c.status === "ok");
  const stoCount = tally(storage, (c) => c.status === "ok");
  const loopCount = tally(reconcilers, (r) => r.status === "ok");

  return (
    // The page stays within the viewport: the header keeps its place and only
    // the sections below it scroll, so the verdict and the refresh button are
    // still there after scrolling down to a failing component.
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">Состояние платформы</h1>
          {data &&
            (data.healthy ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                <IconCircleCheck size={14} stroke={2} /> Всё работает
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                <IconAlertTriangle size={14} stroke={2} /> Есть проблемы
              </span>
            ))}
        </div>
        <div className="flex items-center gap-2">
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
        </div>
      </div>

      {/* The scroll box: -mx-1/px-1 gives the cards' shadows and focus rings the
          room the clipping edge would otherwise cut off. */}
      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-1 pb-1">
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
                caption={loopCount.broken === 0 ? "выполняются штатно" : "со сбоями"}
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

            <ChecksSection />

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
              <Grid cols={2}>
                {reconcilers.map((r) => (
                  <ReconcilerCard key={r.name} r={r} />
                ))}
              </Grid>
            </Section>
          </>
        )}
      </div>
    </div>
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

function Section({
  title,
  hint,
  actions,
  children,
}: {
  title: string;
  hint: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* flex-1 with min-w-0 lets the hint shrink instead of pushing the
            buttons onto a line of their own on a wide screen. On a narrow one
            the hint takes the whole line and the buttons wrap under it, which
            is the only way both of them fit. */}
        <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
          <p className="mb-3 mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">{hint}</p>
        </div>
        {actions && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
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
  const meta = RECONCILERS[r.name];
  return (
    <Card ok={ok} title={meta?.label ?? r.name} verdict={ok ? "В норме" : "Сбой"}>
      {meta && <p className="mt-1 text-xs leading-relaxed text-slate-500">{meta.what}</p>}
      <p className="mt-1.5 text-xs text-slate-400">
        последний успешный запуск: {ago(r.last_success)}
        {r.last_run_ms ? ` · ${r.last_run_ms} мс` : ""}
      </p>
      {!ok && r.last_error && <Detail text={r.last_error} />}
    </Card>
  );
}

// ChecksSection is the answer to "is this portal actually wired to those
// systems", as opposed to "do they answer a ping" - which the section above
// already covers. It keeps its own state: the check set refreshes far more
// slowly than the health probes and has buttons of its own.
function ChecksSection() {
  const { data, error, reload } = useAsync(() => api.getStatusChecks(), [], undefined, {
    refetchInterval: CHECKS_REFRESH_MS,
  });
  // The button queues a round and answers at once, so the page has to notice
  // when the round has actually finished. It remembers which answer was on
  // screen at the time: a different one means the new round has landed. A flag
  // would not do - the snapshot still says "not running" for the moment between
  // the click and the round starting.
  const [awaitedFrom, setAwaitedFrom] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<DeliveryTest | null>(null);
  const [deliveryError, setDeliveryError] = useState("");
  const [testing, setTesting] = useState(false);

  const answer = data?.checked_at ?? "";
  const running = Boolean(data?.running) || (awaitedFrom !== null && awaitedFrom === answer);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(reload, CHECKS_POLL_MS);
    return () => clearInterval(t);
  }, [running, reload]);

  async function runNow() {
    setAwaitedFrom(answer);
    try {
      await api.runStatusChecks();
    } catch {
      setAwaitedFrom(null);
    }
    reload();
  }

  async function testDelivery() {
    setTesting(true);
    setDelivery(null);
    setDeliveryError("");
    try {
      setDelivery(await api.testWebhookDelivery());
    } catch (e) {
      setDeliveryError(errorMessage(e));
    } finally {
      setTesting(false);
      reload();
    }
  }

  // Before the first round the portal reports every check as "не проверено": it
  // must not claim a configuration is fine, nor that it is broken, before it has
  // looked. On screen that is one empty state, not twenty grey cards.
  const results = data?.checked_at ? data.results : [];
  const problems = results.filter((r) => r.verdict === "fail" || r.verdict === "warn").length;

  return (
    <Section
      title="Проверки настройки"
      hint="Отвечает система - ещё не значит, что портал к ней подключён. Здесь портал сам проверяет то, что иначе выясняется на первом настоящем заказе: права токенов, зарегистрированные вебхуки, проекты и кластеры. Все проверки только читают."
      actions={
        <>
          <Button variant="secondary" onPress={testDelivery} isDisabled={testing} className="gap-1.5">
            <IconSend size={16} stroke={1.8} className="text-slate-400" />
            {testing ? "Ждём доставку…" : "Проверить доставку"}
          </Button>
          <Button variant="secondary" onPress={runNow} isDisabled={running} className="gap-1.5">
            <IconRefresh size={16} stroke={1.8} className="text-slate-400" />
            {running ? "Проверяем…" : "Проверить сейчас"}
          </Button>
        </>
      }
    >
      {results.length > 0 && (
        <p className="-mt-1 mb-3 text-xs text-slate-400">
          {running ? "Проверяем прямо сейчас" : `Проверено ${ago(data?.checked_at)}`}
          {problems === 0
            ? " · всё в порядке"
            : ` · требуют внимания: ${problems} из ${results.length}`}
        </p>
      )}

      {(delivery || deliveryError) && (
        <DeliveryResult
          result={delivery}
          error={deliveryError}
          onClose={() => {
            setDelivery(null);
            setDeliveryError("");
          }}
        />
      )}

      {error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : results.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-surface p-4 text-sm text-slate-500">
          {running
            ? "Проверяем настройку, это займёт несколько секунд."
            : "Портал ещё не проверял настройку. Нажмите «Проверить сейчас», чтобы не ждать очередного круга."}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {CHECK_GROUPS.map((group) => {
            const own = results.filter((r) => r.component === group.id);
            if (own.length === 0) return null;
            return (
              <div key={group.id}>
                <h3 className="mb-2 text-xs font-semibold text-slate-500">{group.title}</h3>
                <Grid cols={2}>
                  {own.map((c) => (
                    <CheckCard key={c.id} check={c} />
                  ))}
                </Grid>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function CheckCard({ check }: { check: ConfigCheck }) {
  const text = checkText(check.id);
  const tone = VERDICT_TONE[check.verdict] ?? VERDICT_TONE.unknown;
  const reason = checkReason(check.id, check.reason);
  const facts = Object.entries(check.facts ?? {});
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 bg-surface p-4 shadow-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
          <span className="truncate font-medium text-slate-800">{text.label}</span>
        </div>
        <div className="min-w-0 pl-4">
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{text.what}</p>
          {reason && (
            <p
              className={`mt-1.5 text-xs leading-relaxed ${
                check.verdict === "fail" || check.verdict === "warn"
                  ? "text-slate-700"
                  : "text-slate-400"
              }`}
            >
              {reason}
            </p>
          )}
          {/* Facts in two columns where there is room for them. On a narrow
              card the label would squeeze the value down to one character per
              line, so there the value simply goes under its label. */}
          {facts.length > 0 && (
            <dl className="mt-2 grid grid-cols-1 gap-x-3 gap-y-0.5 text-xs sm:grid-cols-[auto_1fr]">
              {facts.map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="text-slate-400">{factLabel(key)}</dt>
                  <dd className="min-w-0 break-words font-mono text-[11px] text-slate-600">
                    {factValue(value)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {check.vars && check.vars.length > 0 && (
            <p className="mt-2 flex flex-wrap gap-1">
              {check.vars.map((v) => (
                <span
                  key={v}
                  className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500"
                >
                  {v}
                </span>
              ))}
            </p>
          )}
        </div>
      </div>
      <span className={`shrink-0 text-sm font-medium ${tone.text}`}>
        {verdictLabel(check.verdict)}
      </span>
    </div>
  );
}

// DeliveryResult reports the one check that makes something happen outside the
// portal. It stays on screen until dismissed: the answer took ten seconds to
// arrive and is the whole reason the button was pressed.
function DeliveryResult({
  result,
  error,
  onClose,
}: {
  result: DeliveryTest | null;
  error: string;
  onClose: () => void;
}) {
  const bad = Boolean(error) || (result != null && result.outcome !== "delivered");
  return (
    <div
      className={`mb-3 flex items-start justify-between gap-4 rounded-lg border p-3 text-sm ${
        bad ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"
      }`}
    >
      <div className="min-w-0">
        <p>{error || deliveryOutcomeText(result?.outcome ?? "")}</p>
        {result?.detail && <Detail text={result.detail} />}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 cursor-pointer text-xs font-medium underline-offset-2 hover:underline"
      >
        Скрыть
      </button>
    </div>
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
