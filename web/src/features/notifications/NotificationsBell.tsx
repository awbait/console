import { IconBell, IconCheck } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { Button, Dialog, DialogTrigger, Popover } from "react-aria-components";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import type { AppNotification } from "@/api/types";
import { useNotifications } from "@/app/NotificationsContext";
import { useUser } from "@/auth/UserContext";
import { NotificationRow } from "./NotificationRow";

// How many notifications the popover holds. It is a glance at what is new, not
// the archive: the whole feed has a page of its own.
const POPOVER_SIZE = 8;

// The bell in the top bar: how many notifications are waiting, and what they
// are.
//
// The count comes from the notifications context, which owns it for the whole
// app - reading one on the feed page has to change the number here too, and it
// used to leave it stale. The list is the bell's own business: it is only ever
// shown while the popover is open.
export function NotificationsBell() {
  const { user } = useUser();
  const { unread, markRead, markAllRead, onChange } = useNotifications();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [open, setOpen] = useState(false);

  const loadItems = useCallback(() => {
    api
      .listNotifications({ limit: String(POPOVER_SIZE) })
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  // While the popover is open, news re-reads it; closed, there is nothing to
  // refresh and the count in the context is enough.
  useEffect(() => {
    if (!open) return;
    return onChange(loadItems);
  }, [open, onChange, loadItems]);

  // The auditor is addressed by nothing: the role reads, it does not own orders
  // or publish services. A bell that can only ever be empty is furniture.
  if (!user || user.role === "auditor") return null;

  async function readAll() {
    setItems((list) => list?.map((n) => ({ ...n, read: true })) ?? null);
    await markAllRead();
  }

  async function readOne(n: AppNotification) {
    if (n.read) return;
    setItems((list) => list?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? null);
    await markRead(n.id);
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
                onClick={readAll}
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
                    <NotificationRow n={n} onRead={() => readOne(n)} onNavigate={() => setOpen(false)} />
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
