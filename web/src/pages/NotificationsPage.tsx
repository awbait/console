import { IconBellOff, IconCheck } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/api/client";
import type { AppNotification } from "@/api/types";
import { useNotifications } from "@/app/NotificationsContext";
import { NotificationRow } from "@/features/notifications/NotificationRow";
import { Card, ErrorBox, SkeletonRows } from "@/components/ui";

// The whole feed, page by page.
//
// The popover in the top bar answers "what is new"; this page answers "what
// happened" - so it pages backwards through the history instead of holding the
// last handful. Paging is by the time of the oldest row on screen rather than
// by an offset: notifications arrive while the page is open, and an offset
// would quietly show the same row twice.
const PAGE = 30;

export function NotificationsPage() {
  const { markRead, markAllRead, onChange } = useNotifications();
  const [items, setItems] = useState<AppNotification[]>([]);
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

  const unread = items.some((n) => !n.read);

  return (
    <div>
      <div className="mb-4 flex min-h-9 items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Уведомления</h1>
        {unread && (
          <button
            type="button"
            onClick={readAll}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <IconCheck size={16} stroke={2} />
            Прочитать все
          </button>
        )}
      </div>

      {loading ? (
        <SkeletonRows rows={6} />
      ) : error ? (
        <ErrorBox error={error} />
      ) : items.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <IconBellOff size={24} stroke={1.6} />
          </span>
          <p className="text-sm text-slate-500">
            Пока ничего не произошло. Здесь появятся новости о ваших сервисах.
          </p>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-surface shadow-sm">
          <ul className="flex flex-col">
            {items.map((n) => (
              <li key={n.id} className="border-b border-slate-100 last:border-0">
                <NotificationRow n={n} onRead={() => readOne(n)} />
              </li>
            ))}
          </ul>
          {!done && (
            <div className="border-t border-slate-100 p-3 text-center">
              <button
                type="button"
                onClick={loadMore}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-brand-700 outline-none hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                Показать ещё
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
