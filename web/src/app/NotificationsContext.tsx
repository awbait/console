import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { api } from "../api/client";
import { useUser } from "../auth/UserContext";
import { subscribe } from "../lib/sse";

// How many notifications are waiting, in one place.
//
// The count is read in the top bar and changed on the feed page: putting it in
// each of them separately meant reading a notification left the bell showing a
// number that was no longer true until something else happened to refresh it.
// So the count, and the two ways of clearing it, live here.
//
// It is also the only subscriber to the notification stream. One stream per tab
// rather than one per screen showing notifications: the server caps concurrent
// streams, and a second one would buy nothing - the signal carries no content,
// both screens re-read anyway.

interface NotificationsState {
  unread: number;
  // Re-read the count from the server. Called after anything that could have
  // changed it behind our back.
  refresh: () => void;
  // Mark one read: the count drops now and the server is told after. A failed
  // call puts the true number back, which is cheaper than making somebody wait
  // to see their own click.
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  // Fired when the server signals there is news, so an open feed can re-read
  // itself. Returns its own unsubscribe.
  onChange: (fn: () => void) => () => void;
}

const Ctx = createContext<NotificationsState>({
  unread: 0,
  refresh: () => {},
  markRead: async () => {},
  markAllRead: async () => {},
  onChange: () => () => {},
});

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const [unread, setUnread] = useState(0);
  const [listeners] = useState(() => new Set<() => void>());
  // The auditor is addressed by nothing, so there is nothing to count or listen
  // for. Everyone else gets both.
  const enabled = !!user && user.role !== "auditor";

  const refresh = useCallback(() => {
    if (!enabled) return;
    api
      .unreadNotifications()
      .then((r) => setUnread(r.unread))
      .catch(() => {
        /* the bell is not worth an error banner; the next signal retries */
      });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const stop = subscribe(
      "/api/v1/notifications/events",
      {
        notifications_changed: () => {
          refresh();
          for (const fn of listeners) fn();
        },
      },
      "notifications",
    );
    // A tab left open for hours can miss a signal; asking again when the person
    // comes back is cheap and covers it.
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      stop();
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, refresh, listeners]);

  const markRead = useCallback(
    async (id: string) => {
      setUnread((c) => Math.max(0, c - 1));
      await api.readNotification(id).catch(refresh);
    },
    [refresh],
  );

  const markAllRead = useCallback(async () => {
    setUnread(0);
    await api.readAllNotifications().catch(refresh);
  }, [refresh]);

  const onChange = useCallback(
    (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn) as unknown as void;
    },
    [listeners],
  );

  return (
    <Ctx.Provider value={{ unread, refresh, markRead, markAllRead, onChange }}>{children}</Ctx.Provider>
  );
}

export function useNotifications() {
  return useContext(Ctx);
}
