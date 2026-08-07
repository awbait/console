import { IconAlertTriangle, IconEyeOff, IconRefresh, IconSearch, IconX } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Button as AriaButton, Input, SearchField } from "react-aria-components";
import { api } from "../api/client";
import type { ConfigField } from "../api/types";
import { useUser } from "../auth/UserContext";
import { Button, ErrorBox, Hint, SkeletonRows } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { CONFIG_GROUPS, CONFIG_TEXT } from "./configText";

// The configuration page shows how this portal is set up: every setting it
// reads, what it is set to, and what it accepts. Read-only on purpose - the
// portal is configured by its deployment, and a page that could change that
// would be a second, hidden source of truth that the next restart discards.
export function ConfigPage() {
  const { user } = useUser();
  const { data, error, loading, reload } = useAsync(() => api.getConfig(), []);
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const fields = data?.fields ?? [];
    const q = query.trim().toLowerCase();
    const match = (f: ConfigField) =>
      !q ||
      f.name.toLowerCase().includes(q) ||
      f.value.toLowerCase().includes(q) ||
      (CONFIG_TEXT[f.name] ?? "").toLowerCase().includes(q);
    // Known groups first, in the order the page declares them; anything from a
    // group the front end has not heard of still gets a section of its own.
    const known = CONFIG_GROUPS.map((g) => ({ ...g, fields: fields.filter((f) => f.group === g.id).filter(match) }));
    const knownIds = new Set(CONFIG_GROUPS.map((g) => g.id));
    const rest = fields.filter((f) => !knownIds.has(f.group)).filter(match);
    if (rest.length > 0) known.push({ id: "other", label: "Прочее", hint: "", fields: rest });
    return known.filter((g) => g.fields.length > 0);
  }, [data, query]);

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
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Конфигурация портала</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500">
            Настройки, с которыми запущен портал. Только просмотр: значения задаются при запуске, и
            изменить их можно в конфигурации развёртывания. Пароли и токены не показываются.
          </p>
        </div>
        <Button variant="secondary" onPress={reload} isDisabled={loading} className="gap-1.5">
          <IconRefresh size={16} stroke={1.8} className="text-slate-400" />
          {loading ? "Обновляем…" : "Обновить"}
        </Button>
      </div>

      {loading && !data ? (
        <SkeletonRows rows={8} />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
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
            <span className="text-xs text-slate-400">
              {query ? `${shown} из ${total} настроек` : `${total} настроек`}
            </span>
          </div>

          {groups.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">
              Ничего не нашлось. Попробуйте другое слово.
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
                    <Row key={f.name} f={f} first={i === 0} />
                  ))}
                </div>
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}

// One setting. The name and the value are monospaced - they are literals someone
// copies into a deployment - while everything explaining them is prose.
function Row({ f, first }: { f: ConfigField; first: boolean }) {
  const description = CONFIG_TEXT[f.name];
  return (
    <div
      className={`grid grid-cols-1 gap-x-6 gap-y-1.5 px-4 py-3 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] ${
        first ? "" : "border-t border-slate-100"
      }`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-[13px] font-medium text-slate-800">{f.name}</span>
          <StateBadge f={f} />
        </div>
        {description && (
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{description}</p>
        )}
      </div>

      <div className="min-w-0">
        <Value f={f} />
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
          {f.options && f.options.length > 0 && (
            <span>
              возможные значения:{" "}
              {f.options.map((o, i) => (
                <span key={o}>
                  {i > 0 && ", "}
                  <span
                    className={`font-mono ${o === f.value ? "font-medium text-slate-600" : ""}`}
                  >
                    {o}
                  </span>
                </span>
              ))}
            </span>
          )}
          {f.default && (
            <span>
              по умолчанию: <span className="font-mono">{f.default}</span>
            </span>
          )}
          {f.sensitive === "password" && (
            <Hint text="Пароль в строке подключения скрыт. Он есть в конфигурации развёртывания.">
              <AriaButton className="inline-flex items-center gap-1 rounded text-slate-400 outline-none hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-brand-500">
                <IconEyeOff size={13} stroke={1.8} />
                пароль скрыт
              </AriaButton>
            </Hint>
          )}
        </div>
      </div>
    </div>
  );
}

// Value renders what the setting is set to: the literal, or an honest stand-in
// when there is nothing to show.
function Value({ f }: { f: ConfigField }) {
  if (f.secret) {
    if (f.is_empty) return <span className="text-sm text-slate-400">не задано</span>;
    // A secret still equal to the value the portal ships with is the one case
    // where "configured" would be a comforting lie.
    if (f.is_default) {
      return (
        <span className="inline-flex items-center gap-1.5 text-sm text-amber-700">
          <IconAlertTriangle size={14} stroke={1.8} className="text-amber-600" />
          стандартное значение, его нужно заменить
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-slate-500">
        <IconEyeOff size={14} stroke={1.8} className="text-slate-400" />
        задано, значение скрыто
      </span>
    );
  }
  if (f.is_empty) return <span className="text-sm text-slate-400">не задано</span>;
  return (
    <span className="block break-all font-mono text-[13px] leading-relaxed text-slate-800">
      {f.value}
    </span>
  );
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
