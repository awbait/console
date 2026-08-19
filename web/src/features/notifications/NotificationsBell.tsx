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
const POPOVER_SIZE = 5;

// The bell in the top bar: how many notifications are waiting, and what they
// are.
//
// The count comes from the notifications context, which owns it for the whole
// app - reading one on the feed page has to change the number here too. The
// list is the bell's own business: it is only ever shown while the popover is
// open.
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
        className="relative cursor-pointer rounded-md p-2 text-slate-500 outline-none transition-colors hover:bg-slate-50 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        {/* The bell nods while something is waiting: a short swing every few
            seconds rather than a number to read. It stays still for a reader who
            asked not to be moved. */}
        <IconBell
          // Remounted when the bell goes from empty to waiting, so the swing
          // starts over at that moment: a CSS animation added to an element
          // that is already there picks up wherever its clock happens to be.
          key={unread > 0 ? "waiting" : "empty"}
          size={20}
          stroke={1.7}
          className={unread > 0 ? "bell-swing" : undefined}
        />
        {/* A dot, not a count: in the top bar the exact number is noise - what
            matters is whether there is anything at all, and the feed says how
            much. The ring cuts the dot out of the icon underneath instead of
            leaving the two to overlap. */}
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-brand-600 ring-2 ring-surface" />
        )}
      </Button>

      <Popover
        offset={8}
        className="w-[24rem] max-w-[calc(100vw-2rem)] rounded-md border border-slate-200 bg-surface shadow-lg outline-none entering:animate-in entering:fade-in entering:zoom-in-95 exiting:animate-out exiting:fade-out motion-reduce:animate-none"
      >
        <Dialog aria-label="Уведомления" className="outline-none">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
            <h2 className="text-sm font-semibold text-slate-800">Уведомления</h2>
            {unread > 0 && (
              <button
                type="button"
                onClick={readAll}
                className="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-slate-500 outline-none transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <IconCheck size={14} stroke={2} />
                Прочитать все
              </button>
            )}
          </div>

          <div className="scroll-slim max-h-[min(28rem,60vh)] overflow-y-auto">
            {items === null ? (
              <p className="px-3 py-6 text-center text-sm text-slate-400">Загружаем...</p>
            ) : items.length === 0 ? (
              <div className="px-3 py-7 text-center">
                <p className="text-sm text-slate-600">Пока ничего не произошло</p>
                <p className="mt-1 text-xs text-slate-500">
                  Здесь появятся новости о ваших сервисах и заказах.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col">
                {items.map((n) => (
                  <li key={n.id} className="border-b border-slate-100 last:border-0">
                    <NotificationRow
                      n={n}
                      compact
                      onRead={() => readOne(n)}
                      onNavigate={() => setOpen(false)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-slate-100 p-1.5">
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="block cursor-pointer rounded px-2 py-1.5 text-center text-xs font-medium text-brand-700 outline-none transition-colors hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              Все уведомления
            </Link>
          </div>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
