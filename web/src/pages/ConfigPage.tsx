import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleX,
  IconClockQuestion,
  IconInfoCircle,
  IconMinus,
  IconRefresh,
  IconSearch,
  IconSend,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { Button as AriaButton, Input, SearchField } from "react-aria-components";
import { api, errorMessage } from "../api/client";
import type { ConfigCheck, ConfigField, DeliveryTest } from "../api/types";
import {
  checkAction,
  checkReason,
  deliveryOutcomeText,
  factLabel,
  factValue,
  verdictLabel,
} from "../app/configChecks";
import { useUser } from "../auth/UserContext";
import { Button, ErrorBox, Hint, SkeletonRows } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { CONFIG_GROUPS, CONFIG_TEXT } from "./configText";

// How often the page re-reads what the checks found. They run on the portal's
// own far slower schedule; this is only how stale the answer on screen may get.
const CHECKS_REFRESH_MS = 60_000;

// While a round is in flight the page keeps asking, so pressing "проверить
// сейчас" shows the new answer rather than the previous one.
const CHECKS_POLL_MS = 2_000;

// How each verdict looks. A problem carries the portal's usual colours; "не
// проверено" and "не используется" stay grey on purpose, because they are not
// news and must not compete with the rows somebody has to act on.
const VERDICT_STYLE: Record<
  string,
  { pill: string; icon: typeof IconCircleCheck; iconClass: string }
> = {
  ok: {
    pill: "border-emerald-200 bg-emerald-50 text-emerald-700",
    icon: IconCircleCheck,
    iconClass: "text-emerald-500",
  },
  warn: {
    pill: "border-amber-200 bg-amber-50 text-amber-800",
    icon: IconAlertTriangle,
    iconClass: "text-amber-500",
  },
  fail: {
    pill: "border-red-200 bg-red-50 text-red-700",
    icon: IconCircleX,
    iconClass: "text-red-500",
  },
  skip: {
    pill: "border-slate-200 bg-slate-50 text-slate-500",
    icon: IconMinus,
    iconClass: "text-slate-400",
  },
  unknown: {
    pill: "border-slate-200 bg-slate-50 text-slate-500",
    icon: IconClockQuestion,
    iconClass: "text-slate-400",
  },
};

// A verdict worth acting on. The "только проблемы" filter keeps these.
function isProblem(c: ConfigCheck | undefined): boolean {
  return c?.verdict === "fail" || c?.verdict === "warn";
}

// The configuration page shows how this portal is set up: every setting it
// reads, what it is set to, and what it accepts. Read-only on purpose - the
// portal is configured by its deployment, and a page that could change that
// would be a second, hidden source of truth that the next restart discards.
export function ConfigPage() {
  const { user } = useUser();
  const { data, error, loading, reload } = useAsync(() => api.getConfig(), []);
  // What the portal found out about these settings by actually using them.
  // Loaded apart from the settings themselves: it refreshes on its own rhythm
  // and a failure here must not take the page down with it.
  const checks = useAsync(() => api.getStatusChecks(), [], undefined, {
    refetchInterval: CHECKS_REFRESH_MS,
  });
  const [query, setQuery] = useState("");
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [delivery, setDelivery] = useState<DeliveryTest | null>(null);
  const [deliveryError, setDeliveryError] = useState("");
  const [testing, setTesting] = useState(false);
  // The button queues a round and answers at once, so the page has to notice
  // when the round has actually finished. It remembers which answer was on
  // screen at the time: a different one means the new round has landed.
  const [awaitedFrom, setAwaitedFrom] = useState<string | null>(null);

  const answer = checks.data?.checked_at ?? "";
  const running = Boolean(checks.data?.running) || (awaitedFrom !== null && awaitedFrom === answer);
  const reloadChecks = checks.reload;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(reloadChecks, CHECKS_POLL_MS);
    return () => clearInterval(t);
  }, [running, reloadChecks]);

  // A verdict is shown next to the first setting its check names (its anchor),
  // so one knob spread over three variables still gets one answer in one place.
  const byVar = useMemo(() => {
    const m = new Map<string, ConfigCheck>();
    for (const c of checks.data?.checked_at ? (checks.data?.results ?? []) : []) {
      if (c.vars && c.vars.length > 0) m.set(c.vars[0], c);
    }
    return m;
  }, [checks.data]);

  const problems = useMemo(
    () => [...byVar.values()].filter((c) => isProblem(c)).length,
    [byVar],
  );

  async function runChecks() {
    setAwaitedFrom(answer);
    try {
      await api.runStatusChecks();
    } catch {
      setAwaitedFrom(null);
    }
    reloadChecks();
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
      reloadChecks();
    }
  }

  const groups = useMemo(() => {
    const fields = data?.fields ?? [];
    const q = query.trim().toLowerCase();
    const match = (f: ConfigField) =>
      (!problemsOnly || isProblem(byVar.get(f.name))) &&
      (!q ||
        f.name.toLowerCase().includes(q) ||
        f.value.toLowerCase().includes(q) ||
        (CONFIG_TEXT[f.name] ?? "").toLowerCase().includes(q));
    // Known groups first, in the order the page declares them; anything from a
    // group the front end has not heard of still gets a section of its own.
    const known = CONFIG_GROUPS.map((g) => ({ ...g, fields: fields.filter((f) => f.group === g.id).filter(match) }));
    const knownIds = new Set(CONFIG_GROUPS.map((g) => g.id));
    const rest = fields.filter((f) => !knownIds.has(f.group)).filter(match);
    if (rest.length > 0) known.push({ id: "other", label: "Прочее", hint: "", fields: rest });
    return known.filter((g) => g.fields.length > 0);
  }, [data, query, problemsOnly, byVar]);

  if (user?.role !== "admin") {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Раздел доступен только администраторам платформы.
      </div>
    );
  }

  const total = data?.fields.length ?? 0;
  const shown = groups.reduce((n, g) => n + g.fields.length, 0);

  return (
    // Header and search stay put; only the list of settings scrolls. Fifty rows
    // are a long way to scroll back up to the search box.
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Конфигурация портала</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500">
            Настройки, с которыми запущен портал. Портал проверяет их на живых системах и пишет
            результат рядом с каждой: видно не только что задано, но и работает ли оно. Только
            просмотр: значения задаются при запуске. Пароли и токены не показываются.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onPress={testDelivery} isDisabled={testing} className="gap-1.5">
            <IconSend size={16} stroke={1.8} className="text-slate-400" />
            {testing ? "Ждём доставку…" : "Проверить доставку"}
          </Button>
          <Button variant="secondary" onPress={runChecks} isDisabled={running} className="gap-1.5">
            <IconRefresh size={16} stroke={1.8} className="text-slate-400" />
            {running ? "Проверяем…" : "Проверить сейчас"}
          </Button>
        </div>
      </div>

      {!loading && !error && (
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <SearchField
            aria-label="Поиск по настройкам"
            value={query}
            onChange={setQuery}
            className="group relative w-full sm:w-80"
          >
            <IconSearch
              size={16}
              stroke={1.8}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <Input
              placeholder="Найти настройку"
              className="h-9 w-full rounded-md border border-slate-300 bg-surface pl-9 pr-9 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-brand-500"
            />
            <AriaButton className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 outline-none hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-brand-500 group-empty:hidden">
              <IconX size={14} stroke={2} />
            </AriaButton>
          </SearchField>
          <button
            type="button"
            onClick={() => setProblemsOnly((v) => !v)}
            aria-pressed={problemsOnly}
            className={`h-9 shrink-0 cursor-pointer rounded-md border px-3 text-xs font-medium transition-colors ${
              problemsOnly
                ? "border-amber-300 bg-amber-50 text-amber-800"
                : "border-slate-300 bg-surface text-slate-600 hover:bg-slate-50"
            }`}
          >
            Только проблемы{problems > 0 ? ` (${problems})` : ""}
          </button>
          <span className="text-xs text-slate-400">
            {query || problemsOnly ? `${shown} из ${total} настроек` : `${total} настроек`}
            {checksFreshness(checks.data?.checked_at, running, problems)}
          </span>
        </div>
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

      {/* -mx-1/px-1 keeps the cards' shadows and focus rings off the clipping
          edge of the scroll box. */}
      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-1 pb-1">
        {loading && !data ? (
          <SkeletonRows rows={8} />
        ) : error ? (
          <ErrorBox error={error} onRetry={reload} />
        ) : groups.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            {problemsOnly && !query
              ? "Проблем в настройке нет."
              : "Ничего не нашлось. Попробуйте другое слово."}
          </p>
        ) : (
          groups.map((g) => (
            <section key={g.id}>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                {g.label}
              </h2>
              {g.hint && (
                <p className="mb-3 mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">{g.hint}</p>
              )}
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-surface shadow-sm">
                {g.fields.map((f, i) => (
                  <Row key={f.name} f={f} first={i === 0} check={byVar.get(f.name)} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

// One setting. The name and the value are monospaced - they are literals someone
// copies into a deployment - while everything explaining them is prose. A check
// that is about this setting adds its verdict under the value, the way Grafana
// puts the result of "Save & test" under the form it tested.
function Row({ f, first, check }: { f: ConfigField; first: boolean; check?: ConfigCheck }) {
  const description = CONFIG_TEXT[f.name];
  return (
    // Three columns on a wide screen: what the setting is, what it is set to,
    // and whether it works. The verdict keeps a column of its own so the page
    // can be scanned down its right edge, the way Argo CD's settings are. On a
    // narrow screen it moves up under the name, where it is still the second
    // thing read rather than the last.
    <div
      className={`grid grid-cols-1 gap-x-6 gap-y-1.5 px-4 py-3 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)_minmax(0,9rem)] ${
        first ? "" : "border-t border-slate-100"
      }`}
    >
      <div className="min-w-0 md:order-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-[13px] font-medium text-slate-800">{f.name}</span>
          <FieldHint f={f} />
          <StateBadge f={f} />
        </div>
        {description && (
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{description}</p>
        )}
      </div>

      <div className="order-3 min-w-0 md:order-2">
        <Value f={f} />
      </div>

      <div className="order-2 min-w-0 md:order-3 md:flex md:h-9 md:items-center">
        {check && <CheckBadge check={check} />}
      </div>
    </div>
  );
}

// CheckBadge is the right-hand column: whether this setting works, in one word
// and one colour, so the page can be scanned down its edge. Everything behind
// that word - what was seen, what to do, the data it was read from - is one
// hover or one Tab away, because on a page of sixty settings it would otherwise
// be sixty paragraphs nobody asked for.
function CheckBadge({ check }: { check: ConfigCheck }) {
  const style = VERDICT_STYLE[check.verdict] ?? VERDICT_STYLE.unknown;
  const Icon = style.icon;
  // Whether there is anything behind the word has to be decided from the data.
  // Asking the component - `const detail = <CheckDetail/>` - never answers no:
  // an element is truthy even when rendering it produces nothing, and every
  // verdict got a tooltip, empty ones included.
  const reason = checkReason(check.id, check.reason);
  const action = checkAction(check.id, check.reason);
  const facts = Object.entries(check.facts ?? {});
  const hasDetail = Boolean(reason || action || facts.length > 0);
  const pill = (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${style.pill}`}
    >
      <Icon size={13} stroke={2} className={`shrink-0 ${style.iconClass}`} />
      {verdictLabel(check.verdict)}
    </span>
  );
  // A verdict with nothing behind it is not worth a trigger that promises more.
  if (!hasDetail) return pill;
  return (
    <Hint text={<CheckDetail reason={reason} action={action} facts={facts} />} placement="top end">
      <AriaButton
        aria-label={`Подробнее: ${verdictLabel(check.verdict)}`}
        className="cursor-help rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        {pill}
      </AriaButton>
    </Hint>
  );
}

// CheckDetail is what stands behind the verdict: what was seen, what to do about
// it, and the data it was read from. It is only ever rendered when there is
// something in it - the badge decides that from the same three values.
function CheckDetail({
  reason,
  action,
  facts,
}: {
  reason: string;
  action: string;
  facts: [string, string][];
}) {
  return (
    <div className="max-w-[18rem] text-left">
      {reason && <p className="leading-relaxed">{reason}</p>}
      {action && (
        <p className={`leading-relaxed ${reason ? "mt-1.5" : ""}`}>
          <span className="font-semibold">Что сделать: </span>
          {action}
        </p>
      )}
      {facts.length > 0 && (
        <dl
          className={`grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-0.5 ${
            reason || action ? "mt-2 border-t border-overlay-edge pt-2" : ""
          }`}
        >
          {facts.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-slate-500">{factLabel(key)}</dt>
              <dd className="min-w-0 break-words font-mono text-[11px] text-slate-700">
                {factValue(value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

// checksFreshness says how old the verdicts on screen are, and whether anything
// needs doing. Appended to the settings count, so the page keeps one status line
// rather than two.
function checksFreshness(checkedAt: string | undefined, running: boolean, problems: number): string {
  if (running) return " · проверяем";
  if (!checkedAt) return "";
  const t = new Date(checkedAt).getTime();
  if (Number.isNaN(t)) return "";
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  const when = m < 1 ? "только что" : m < 60 ? `${m} мин назад` : `${Math.round(m / 60)} ч назад`;
  return problems === 0 ? ` · проверено ${when}, всё в порядке` : ` · проверено ${when}`;
}

// DeliveryResult reports the one check that makes something happen outside the
// portal. It stays until dismissed: the answer took ten seconds to arrive and is
// the whole reason the button was pressed.
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
      className={`flex shrink-0 items-start justify-between gap-4 rounded-lg border p-3 text-sm ${
        bad
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-emerald-200 bg-emerald-50 text-emerald-800"
      }`}
    >
      <div className="min-w-0">
        <p>{error || deliveryOutcomeText(result?.outcome ?? "")}</p>
        {result?.detail && (
          <p className="mt-2 break-words rounded bg-white/60 px-2 py-1.5 font-mono text-[11px] leading-relaxed">
            {result.detail}
          </p>
        )}
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

// FieldHint carries what a setting accepts and what it falls back to. Those two
// belong together and neither is worth a line of its own next to fifty other
// settings, so they live behind the info icon next to the name.
function FieldHint({ f }: { f: ConfigField }) {
  const parts: string[] = [];
  if (f.options && f.options.length > 0) parts.push(`Возможные значения: ${f.options.join(", ")}.`);
  if (f.default) parts.push(`По умолчанию: ${f.default}.`);
  if (f.sensitive === "password") parts.push("Пароль в строке подключения скрыт.");
  if (f.secret) parts.push("Значение не покидает портал: видно только, задано оно или нет.");
  if (parts.length === 0) return null;
  return (
    <Hint text={parts.join(" ")}>
      <AriaButton
        aria-label={`Подробнее о ${f.name}`}
        className="shrink-0 rounded text-slate-300 outline-none transition-colors hover:text-slate-500 focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <IconInfoCircle size={15} stroke={1.8} />
      </AriaButton>
    </Hint>
  );
}

// Value renders what the setting is set to, in a disabled field. A field rather
// than plain text because the value is a literal someone copies out and, on this
// page, one they cannot change here: the greyed-out input says both at once.
function Value({ f }: { f: ConfigField }) {
  const shown = valueText(f);
  // A secret still equal to the value the portal ships with is the one case
  // where "configured" would be a comforting lie.
  const warn = f.secret && f.is_default;
  return (
    <div className="min-w-0">
      <input
        readOnly
        disabled
        value={shown.text}
        aria-label={f.name}
        title={f.is_empty || f.secret ? undefined : f.value}
        className={`h-9 w-full cursor-default rounded-md border bg-slate-50 px-2.5 text-[13px] outline-none ${
          warn
            ? "border-amber-200 text-amber-700"
            : shown.literal
              ? "border-slate-200 font-mono text-slate-700"
              : "border-slate-200 text-slate-400"
        }`}
      />
      {warn && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-amber-700">
          <IconAlertTriangle size={13} stroke={1.8} className="shrink-0 text-amber-600" />
          Стандартный секрет: его нужно заменить.
        </p>
      )}
    </div>
  );
}

// valueText picks what goes into the field, and whether it is a literal (shown
// monospaced) or a stand-in sentence.
function valueText(f: ConfigField): { text: string; literal: boolean } {
  if (f.secret) {
    if (f.is_empty) return { text: "не задано", literal: false };
    if (f.is_default) return { text: "стандартное значение", literal: false };
    return { text: "задано, значение скрыто", literal: false };
  }
  if (f.is_empty) return { text: "не задано", literal: false };
  return { text: f.value, literal: true };
}

// StateBadge answers the question an admin actually has when scanning the page:
// did this deployment choose the value, or is it whatever the portal ships with?
function StateBadge({ f }: { f: ConfigField }) {
  if (f.secret) {
    if (f.is_empty) return <Badge tone="slate">не задан</Badge>;
    if (f.is_default) return <Badge tone="amber">стандартный</Badge>;
    return <Badge tone="emerald">задан</Badge>;
  }
  if (f.is_empty) return <Badge tone="slate">пусто</Badge>;
  if (f.is_set) return <Badge tone="brand">задано</Badge>;
  return <Badge tone="slate">по умолчанию</Badge>;
}

const BADGE_TONES = {
  slate: "bg-slate-100 text-slate-500",
  brand: "bg-brand-50 text-brand-700",
  emerald: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
} as const;

function Badge({ tone, children }: { tone: keyof typeof BADGE_TONES; children: React.ReactNode }) {
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}
