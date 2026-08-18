import { IconBell, IconCheck } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { Button, Dialog, DialogTrigger, Popover } from "react-aria-components";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import type { AppNotification } from "@/api/types";
import { useUser } from "@/auth/UserContext";
import { attachSseLogger } from "@/lib/sse";
import { NotificationRow } from "./NotificationRow";

// How many notifications the popover holds. It is a glance at what is new, not
// the archive: the whole feed has a page of its own.
const POPOVER_SIZE = 8;

// The bell in the top bar: how many notifications are waiting, and what they
// are.
//
// The count is fetched once and then kept fresh by the portal's own event
// stream, which sends a signal and no content - the feed itself is read over
// the normal endpoint, filtered by who is asking, so a browser never receives a
// notification addressed to somebody else.
export function NotificationsBell() {
  const { user } = useUser();
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [open, setOpen] = useState(false);

  const refreshCount = useCallback(() => {
    api
      .unreadNotifications()
      .then((r) => setUnread(r.unread))
      .catch(() => {
        /* the bell is not worth an error banner: the next signal retries */
      });
  }, []);

  const loadItems = useCallback(() => {
    api
      .listNotifications({ limit: String(POPOVER_SIZE) })
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    refreshCount();
    const es = new EventSource("/api/v1/notifications/events");
    attachSseLogger(es, "notifications");
    es.addEventListener("notifications_changed", () => {
      refreshCount();
      // Only when somebody is looking: a closed popover has nothing to refresh.
      setOpen((isOpen) => {
        if (isOpen) loadItems();
        return isOpen;
      });
    });
    return () => es.close();
  }, [refreshCount, loadItems]);

  // A tab left open for hours misses signals if the stream drops; asking again
  // when the person comes back is cheap and covers it.
  useEffect(() => {
    const onFocus = () => refreshCount();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshCount]);

  // The auditor is addressed by nothing: the role reads, it does not own orders
  // or publish services. A bell that can only ever be empty is furniture.
  if (!user || user.role === "auditor") return null;

  async function markAllRead() {
    await api.readAllNotifications().catch(() => {});
    setUnread(0);
    setItems((list) => list?.map((n) => ({ ...n, read: true })) ?? null);
  }

  async function markRead(n: AppNotification) {
    if (n.read) return;
    setItems((list) => list?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? null);
    setUnread((c) => Math.max(0, c - 1));
    await api.readNotification(n.id).catch(refreshCount);
  }

  return (
    <DialogTrigger
      isOpen={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        if (isOpen) loadItems();
      }}
    >
      <Button
        aria-label={unread > 0 ? `Уведомления, непрочитанных: ${unread}` : "Уведомления"}
        className="relative rounded-md p-2 text-slate-500 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <IconBell size={20} stroke={1.7} />
        {/* The count sits on the bell rather than beside it: it belongs to the
            bell, and the top bar has no room for a second element per state. */}
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold leading-none text-on-accent">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Button>
      <Popover className="w-[26rem] max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-surface shadow-lg outline-none entering:animate-in entering:fade-in">
        <Dialog aria-label="Уведомления" className="outline-none">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-slate-800">Уведомления</h2>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 outline-none hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <IconCheck size={14} stroke={2} />
                Прочитать все
              </button>
            )}
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {items === null ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400">Загружаем...</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">
                Пока ничего не произошло. Здесь появятся новости о ваших сервисах.
              </p>
            ) : (
              <ul className="flex flex-col">
                {items.map((n) => (
                  <li key={n.id} className="border-b border-slate-100 last:border-0">
                    <NotificationRow n={n} onRead={() => markRead(n)} onNavigate={() => setOpen(false)} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-slate-100 px-4 py-2 text-center">
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="text-xs font-medium text-brand-700 outline-none hover:text-brand-800 focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              Все уведомления
            </Link>
          </div>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
