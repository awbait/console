import { IconActivity, IconBox, IconClick, IconUsers } from "@tabler/icons-react";
import { type JSX, type KeyboardEvent, type PointerEvent, useId, useState } from "react";
import type { BoardTiles as BoardTilesData, SeriesPoint } from "./stub";

const text = {
  region: "Показатели платформы",
  orders: "Новые заказы",
  actions: "Действия по заказам",
  users: "Активные пользователи",
  online: "Онлайн сейчас",
  today: "Сегодня",
  total: "Всего",
  signedIn: "Вошли сегодня",
  now: "Сейчас",
  days: "14 дней",
  hours: "24 часа",
  empty: "Нет данных",
  navigation: "Стрелки влево и вправо: выбор точки. Home и End: начало и конец. Escape: скрыть подсказку.",
};

const numberFormat = new Intl.NumberFormat("ru-RU");
const dayFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
});
const hourFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

type TrendKind = "daily" | "hourly";

type TileProps = {
  title: string;
  Icon: typeof IconBox;
  value: number;
  valueLabel: string;
  total?: number;
  points: SeriesPoint[];
  kind: TrendKind;
};

const plot = {
  width: 280,
  height: 48,
  top: 6,
  bottom: 43,
};

function formatPoint(at: string, kind: TrendKind): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  return (kind === "daily" ? dayFormat : hourFormat).format(date);
}

export function BoardTiles({ tiles }: { tiles: BoardTilesData }): JSX.Element {
  return (
    <section
      aria-label={text.region}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      <Tile
        title={text.orders}
        Icon={IconBox}
        value={tiles.orders.today}
        valueLabel={text.today}
        total={tiles.orders.total}
        points={tiles.orders.series}
        kind="daily"
      />
      <Tile
        title={text.actions}
        Icon={IconClick}
        value={tiles.actions.today}
        valueLabel={text.today}
        points={tiles.actions.series}
        kind="daily"
      />
      <Tile
        title={text.users}
        Icon={IconUsers}
        value={tiles.users.today}
        valueLabel={text.signedIn}
        total={tiles.users.total}
        points={tiles.users.series}
        kind="daily"
      />
      <Tile
        title={text.online}
        Icon={IconActivity}
        value={tiles.online.now}
        valueLabel={text.now}
        points={tiles.online.series}
        kind="hourly"
      />
    </section>
  );
}

function Tile({
  title,
  Icon,
  value,
  valueLabel,
  total,
  points,
  kind,
}: TileProps): JSX.Element {
  const headingId = useId();

  return (
    <article
      aria-labelledby={headingId}
      className="min-w-0 rounded-xl border border-slate-200 bg-surface p-4 shadow-sm"
    >
      <header className="flex h-8 min-w-0 items-center justify-between gap-3">
        <h3
          id={headingId}
          title={title}
          className="truncate text-sm font-medium text-slate-700"
        >
          {title}
        </h3>
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600"
        >
          <Icon size={18} stroke={1.7} />
        </span>
      </header>

      <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4">
        <div className="flex min-w-0 flex-col">
          <dt className="order-2 mt-1 h-4 truncate text-xs leading-4 text-slate-500">
            {valueLabel}
          </dt>
          <dd
            title={numberFormat.format(value)}
            className="h-10 truncate text-[2rem] font-semibold leading-10 tracking-tight text-slate-900 tabular-nums"
          >
            {numberFormat.format(value)}
          </dd>
        </div>
        {total !== undefined && (
          <div className="flex min-w-0 flex-col text-right">
            <dt className="order-2 mt-1 h-4 text-xs leading-4 text-slate-500">
              {text.total}
            </dt>
            <dd
              title={numberFormat.format(total)}
              className="flex h-10 items-baseline justify-end pt-[10px] text-lg font-medium leading-7 tracking-tight text-slate-500 tabular-nums"
            >
              {numberFormat.format(total)}
            </dd>
          </div>
        )}
      </dl>

      <Trend points={points} kind={kind} label={title} />
    </article>
  );
}

function Trend({
  points,
  kind,
  label,
}: {
  points: SeriesPoint[];
  kind: TrendKind;
  label: string;
}): JSX.Element {
  const hintId = useId();
  const tooltipId = useId();
  const [pointerIndex, setPointerIndex] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const data = points.slice(kind === "daily" ? -14 : -24);
  const count = data.length;
  const last = count - 1;
  const period = kind === "daily" ? text.days : text.hours;
  const selectedIndex = pointerIndex ?? focusIndex;
  const activeIndex =
    !dismissed && selectedIndex !== null && count > 0
      ? Math.max(0, Math.min(last, selectedIndex))
      : null;
  const activePoint = activeIndex === null ? undefined : data[activeIndex];
  const maximum = Math.max(
    1,
    ...data.map((point) => (Number.isFinite(point.value) ? point.value : 0)),
  );

  const x = (index: number): number => ((index + 0.5) / Math.max(1, count)) * plot.width;
  const y = (value: number): number => {
    const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
    return plot.bottom - (safeValue / maximum) * (plot.bottom - plot.top);
  };

  const line = data
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(point.value)}`)
    .join(" ");
  const markerIndex = activeIndex ?? last;
  const marker = data[markerIndex];
  const tooltipPosition = activeIndex === null ? 50 : (x(activeIndex) / plot.width) * 100;
  const tooltipAlignment =
    tooltipPosition < 25
      ? "translate-x-0"
      : tooltipPosition > 75
        ? "-translate-x-full"
        : "-translate-x-1/2";
  const tooltipLeft =
    tooltipPosition < 25 ? 0 : tooltipPosition > 75 ? 100 : tooltipPosition;

  function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
    if (count === 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0) return;
    const index = Math.floor(((event.clientX - bounds.left) / bounds.width) * count);
    setPointerIndex(Math.max(0, Math.min(last, index)));
    setDismissed(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (count === 0) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setDismissed(true);
      return;
    }

    const current = activeIndex ?? last;
    let next: number;
    switch (event.key) {
      case "ArrowLeft":
        next = Math.max(0, current - 1);
        break;
      case "ArrowRight":
        next = Math.min(last, current + 1);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }

    event.preventDefault();
    setPointerIndex(null);
    setFocusIndex(next);
    setDismissed(false);
  }

  return (
    <div className="mt-4">
      <div aria-hidden="true" className="mb-1 text-right text-[10px] leading-4 text-slate-500">
        {period}
      </div>
      <div
        role="group"
        tabIndex={count > 0 ? 0 : undefined}
        aria-label={`${label}, ${period}`}
        aria-describedby={
          count > 0 ? `${hintId}${activePoint ? ` ${tooltipId}` : ""}` : undefined
        }
        className="relative h-12 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-4 focus-visible:ring-offset-surface"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setPointerIndex(null)}
        onPointerCancel={() => setPointerIndex(null)}
        onFocus={() => {
          setFocusIndex(last);
          setDismissed(false);
        }}
        onBlur={() => {
          setFocusIndex(null);
          setPointerIndex(null);
          setDismissed(false);
        }}
        onKeyDown={handleKeyDown}
      >
        {count === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-500">
            {text.empty}
          </div>
        ) : (
          <>
            <span id={hintId} className="sr-only">
              {text.navigation}
            </span>
            <span className="sr-only">
              {data
                .map((point) => `${formatPoint(point.at, kind)}: ${numberFormat.format(point.value)}`)
                .join(", ")}
            </span>
            <svg
              viewBox={`0 0 ${plot.width} ${plot.height}`}
              preserveAspectRatio="none"
              className="block h-full w-full overflow-visible"
              aria-hidden="true"
            >
              <line
                x1={0}
                x2={plot.width}
                y1={plot.bottom}
                y2={plot.bottom}
                stroke="currentColor"
                className="text-slate-200"
                vectorEffect="non-scaling-stroke"
              />

              {kind === "daily" ? (
                data.map((point, index) => {
                  const width = Math.min(11, (plot.width / count) * 0.55);
                  const height = Math.max(2, plot.bottom - y(point.value));

                  return (
                    <rect
                      key={`${point.at}-${index}`}
                      x={x(index) - width / 2}
                      y={plot.bottom - height}
                      width={width}
                      height={height}
                      rx={1.5}
                      fill="currentColor"
                      className={
                        index === activeIndex || index === last
                          ? "text-brand-500 motion-safe:transition-colors motion-safe:duration-150"
                          : "text-slate-400 motion-safe:transition-colors motion-safe:duration-150"
                      }
                    />
                  );
                })
              ) : (
                <>
                  <path
                    d={line}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    className="text-slate-500"
                  />
                  {activeIndex !== null && activePoint && (
                    <line
                      x1={x(activeIndex)}
                      x2={x(activeIndex)}
                      y1={plot.top}
                      y2={plot.bottom}
                      stroke="currentColor"
                      strokeDasharray="2 3"
                      vectorEffect="non-scaling-stroke"
                      className="text-slate-300"
                    />
                  )}
                </>
              )}
            </svg>

            {kind === "hourly" && marker && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-500 ring-2 ring-surface"
                style={{
                  left: `${(x(markerIndex) / plot.width) * 100}%`,
                  top: `${(y(marker.value) / plot.height) * 100}%`,
                }}
              />
            )}

            {activePoint && (
              <div
                id={tooltipId}
                role="tooltip"
                className={`pointer-events-none absolute bottom-full z-20 mb-2 max-w-full whitespace-nowrap rounded-md border border-overlay-edge bg-overlay px-2.5 py-1.5 text-xs leading-4 shadow-sm ${tooltipAlignment}`}
                style={{ left: `${tooltipLeft}%` }}
              >
                <span className="text-slate-600">{formatPoint(activePoint.at, kind)}</span>
                <span className="ml-3 font-semibold text-slate-900 tabular-nums">
                  {numberFormat.format(activePoint.value)}
                </span>
              </div>
            )}

            <span className="sr-only" aria-live="polite" aria-atomic="true">
              {focusIndex !== null && activePoint
                ? `${formatPoint(activePoint.at, kind)}: ${numberFormat.format(activePoint.value)}`
                : ""}
            </span>
          </>
        )}
      </div>
    </div>
  );
}