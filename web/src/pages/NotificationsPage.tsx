import { IconBellOff, IconCheck, IconInbox } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/api/client";
import type { AppNotification } from "@/api/types";
import { useNotifications } from "@/app/NotificationsContext";
import { Card, ErrorBox, SkeletonRows } from "@/components/ui";
import { NotificationRow } from "@/features/notifications/NotificationRow";
import { dayLabel } from "@/lib/time";

// The whole feed, day by day.
//
// The popover in the top bar answers "what is new"; this page answers "what
// happened", so it reads as a history: rows grouped under the day they belong
// to, the same way an order's own history reads. A flat list of forty lines is
// what it was before, and nothing in it told you where yesterday ended.
//
// Paging is by the time of the oldest row on screen rather than by an offset:
// notifications arrive while the page is open, and an offset would quietly show
// the same row twice.
const PAGE = 30;

type Filter = "all" | "unread";

export function NotificationsPage() {
  const { unread, markRead, markAllRead, onChange } = useNotifications();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);

  const load = useCallback(async (before?: string) => {
    const params: Record<string, string> = { limit: String(PAGE) };
    if (before) params.before = before;
    return api.listNotifications(params);
  }, []);

  const loadFirstPage = useCallback(() => {
    let alive = true;
    load()
      .then((list) => {
        if (!alive) return;
        setItems(list);
        setDone(list.length < PAGE);
      })
      .catch((e) => alive && setError(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [load]);

  useEffect(() => loadFirstPage(), [loadFirstPage]);

  // News while the page is open belongs at the top of it, not behind a reload.
  // The pages already loaded below are dropped with it: a new notification
  // shifts everything down, and keeping them would mean showing a row twice.
  useEffect(() => onChange(() => loadFirstPage()), [onChange, loadFirstPage]);

  async function loadMore() {
    const oldest = items[items.length - 1];
    if (!oldest) return;
    try {
      const more = await load(oldest.created_at);
      setItems((prev) => [...prev, ...more]);
      setDone(more.length < PAGE);
    } catch (e) {
      setError(e as Error);
    }
  }

  async function readAll() {
    setItems((list) => list.map((n) => ({ ...n, read: true })));
    await markAllRead();
  }

  function readOne(n: AppNotification) {
    if (n.read) return;
    setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    void markRead(n.id);
  }

  const shown = filter === "unread" ? items.filter((n) => !n.read) : items;
  const days = groupByDay(shown);

  return (
    // Same shape as the platform status page: the header and the filters keep
    // their place, and only the feed below them scrolls. A history is read by
    // scrolling, and the way to mark it all read should not scroll away with it.
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Уведомления</h1>
        {unread > 0 && (
          <button
            type="button"
            onClick={readAll}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 outline-none transition-colors hover:bg-slate-50 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <IconCheck size={16} stroke={2} />
            Прочитать все
          </button>
        )}
      </div>

      {/* Two chips rather than a dropdown: there are two answers, and the one in
          force has to be readable without opening anything. Same shape as the
          filters over the order list. */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
          Все
        </FilterChip>
        <FilterChip active={filter === "unread"} onClick={() => setFilter("unread")}>
          Непрочитанные
          {unread > 0 && <span className="ml-1 tabular-nums text-slate-400">{unread}</span>}
        </FilterChip>
      </div>

      {/* The scroll box: -mx-1/px-1 gives the cards' shadows and focus rings the
          room the clipping edge would otherwise cut off. */}
      <div className="scroll-slim -mx-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1 pb-1">
        {loading ? (
          <SkeletonRows rows={6} />
        ) : error ? (
          <ErrorBox error={error} />
        ) : shown.length === 0 ? (
          <EmptyFeed filter={filter} onShowAll={() => setFilter("all")} />
        ) : (
          <>
            {days.map(([day, rows]) => (
              <section key={day}>
                {/* The day names the group and scrolls away with it. It used to
                    stick to the top, and a translucent strip followed it down
                    the page - the blur behind it never matched what it covered. */}
                <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {day}
                </h2>
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-surface shadow-sm">
                  <ul className="flex flex-col">
                    {rows.map((n) => (
                      <li key={n.id} className="border-b border-slate-100 last:border-0">
                        <NotificationRow n={n} onRead={() => readOne(n)} />
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            ))}

            {!done && (
              <div className="text-center">
                <button
                  type="button"
                  onClick={loadMore}
                  className="cursor-pointer rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 outline-none transition-colors hover:bg-slate-50 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  Показать ещё
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// groupByDay keeps the order it was given - the feed arrives newest first - and
// puts each row under the day it happened.
function groupByDay(items: AppNotification[]): [string, AppNotification[]][] {
  const days: [string, AppNotification[]][] = [];
  for (const n of items) {
    const label = dayLabel(n.created_at);
    const last = days[days.length - 1];
    if (last && last[0] === label) last[1].push(n);
    else days.push([label, [n]]);
  }
  return days;
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex cursor-pointer items-center rounded-full border px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 ${
        active
          ? "border-brand-200 bg-brand-50 text-brand-700"
          : "border-slate-200 text-slate-600 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

// An empty feed says which emptiness it is: nothing has happened yet, or
// nothing is left unread. The second one is an achievement and offers the way
// back to the history.
function EmptyFeed({ filter, onShowAll }: { filter: Filter; onShowAll: () => void }) {
  const unreadFilter = filter === "unread";
  const Icon = unreadFilter ? IconInbox : IconBellOff;
  return (
    <Card className="flex flex-col items-center gap-3 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <Icon size={24} stroke={1.6} />
      </span>
      <div>
        <p className="text-sm font-medium text-slate-700">
          {unreadFilter ? "Всё прочитано" : "Пока ничего не произошло"}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          {unreadFilter
            ? "Новые уведомления появятся здесь и на колокольчике в шапке."
            : "Здесь появятся новости о ваших сервисах и заказах."}
        </p>
      </div>
      {unreadFilter && (
        <button
          type="button"
          onClick={onShowAll}
          className="cursor-pointer rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 outline-none transition-colors hover:bg-slate-50 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          Показать все
        </button>
      )}
    </Card>
  );
}
