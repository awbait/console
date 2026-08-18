import {
  IconAlertTriangle,
  IconArrowUpCircle,
  IconCircleCheck,
  IconInfoCircle,
  IconRefreshAlert,
  IconRocket,
  IconSparkles,
} from "@tabler/icons-react";
import type { ComponentType } from "react";
import { Link } from "react-router-dom";
import type { AppNotification } from "@/api/types";
import { fmtDateTime, fmtRelative } from "@/lib/time";
import { notificationLink, notificationText } from "./text";

type IconType = ComponentType<{ size?: number; stroke?: number; className?: string }>;

// A shape per kind, a colour per level. The shape says what happened at a
// glance, and it carries the meaning on its own so the row is legible without
// relying on colour.
const ICONS: Record<string, IconType> = {
  order_healthy: IconCircleCheck,
  order_degraded: IconAlertTriangle,
  order_change_blocked: IconRefreshAlert,
  version_approved: IconCircleCheck,
  version_rejected: IconAlertTriangle,
  chart_version_available: IconArrowUpCircle,
  portal_updated: IconSparkles,
};

function iconFor(n: AppNotification): IconType {
  return ICONS[n.kind] ?? (n.subject_type === "order" ? IconRocket : IconInfoCircle);
}

// One notification: what happened, when, and where to go about it.
//
// The whole row is the link, so the target is the size of the row rather than a
// word inside it, and opening it marks it read - going to look at the thing is
// the same as having read about it.
export function NotificationRow({
  n,
  onRead,
  onNavigate,
}: {
  n: AppNotification;
  onRead: () => void;
  onNavigate?: () => void;
}) {
  const Icon = iconFor(n);
  const to = notificationLink(n);
  const attention = n.level === "attention";

  const body = (
    <>
      <span
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          attention ? "bg-red-100 text-red-600" : "bg-brand-50 text-brand-600"
        }`}
      >
        <Icon size={16} stroke={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-sm ${n.read ? "text-slate-500" : "font-medium text-slate-800"}`}>
          {notificationText(n)}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
          <time dateTime={n.created_at} title={fmtDateTime(n.created_at)}>
            {fmtRelative(n.created_at)}
          </time>
          {n.actor_name && <span className="truncate">{n.actor_name}</span>}
        </span>
      </span>
      {/* Unread is a dot, not a background: a feed of coloured strips reads as
          an alarm, and most of what is here is simply news. */}
      {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="Не прочитано" />}
    </>
  );

  const shell =
    "flex w-full items-start gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-slate-50 focus-visible:bg-slate-50";

  if (!to) {
    return (
      <button type="button" onClick={onRead} className={shell}>
        {body}
      </button>
    );
  }
  return (
    <Link
      to={to}
      onClick={() => {
        onRead();
        onNavigate?.();
      }}
      className={shell}
    >
      {body}
    </Link>
  );
}
