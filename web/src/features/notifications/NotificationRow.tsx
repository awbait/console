import {
  IconAlertTriangle,
  IconArchive,
  IconArrowUpCircle,
  IconCheck,
  IconCircleCheck,
  IconClipboardCheck,
  IconInfoCircle,
  IconPackageImport,
  IconPackageOff,
  IconRefreshAlert,
  IconRocket,
  IconSettingsCheck,
  IconSettingsExclamation,
  IconSparkles,
  IconTrashOff,
  IconUser,
} from "@tabler/icons-react";
import type { ComponentType } from "react";
import { Link } from "react-router-dom";
import type { AppNotification } from "@/api/types";
import { fmtDateTime, fmtRecent } from "@/lib/time";
import { notificationLink, notificationText } from "./text";

type IconType = ComponentType<{ size?: number; stroke?: number; className?: string }>;

// A shape per kind, a colour per level. The shape says what happened at a
// glance, and it carries the meaning on its own so the row is legible without
// relying on colour.
const ICONS: Record<string, IconType> = {
  order_healthy: IconCircleCheck,
  order_degraded: IconAlertTriangle,
  order_change_blocked: IconRefreshAlert,
  order_delete_stalled: IconTrashOff,
  version_approved: IconCircleCheck,
  version_rejected: IconAlertTriangle,
  chart_version_available: IconArrowUpCircle,
  chart_version_missing: IconPackageOff,
  version_deprecated: IconArchive,
  version_submitted: IconClipboardCheck,
  chart_discovered: IconPackageImport,
  portal_updated: IconSparkles,
  config_check_failed: IconSettingsExclamation,
  config_check_recovered: IconSettingsCheck,
};

function iconFor(n: AppNotification): IconType {
  return ICONS[n.kind] ?? (n.subject_type === "order" ? IconRocket : IconInfoCircle);
}

// One notification: what happened, when, and two ways to be done with it.
//
// Opening it is one of them - going to look at the thing is the same as having
// read about it. The other is the mark on the right: unread shows a dot, and
// pointing at the row turns that dot into a button, because putting a
// notification away should not require visiting what it is about.
//
// The row is a grid rather than one big link: a button inside a link is not a
// thing a browser can render, and each half needs its own target.
export function NotificationRow({
  n,
  onRead,
  onNavigate,
  compact = false,
}: {
  n: AppNotification;
  onRead: () => void;
  onNavigate?: () => void;
  // In the popover the rows are tighter: it is a glance at what is new, and the
  // whole feed has a page where the same rows breathe.
  compact?: boolean;
}) {
  const Icon = iconFor(n);
  const to = notificationLink(n);
  const attention = n.level === "attention";
  const pad = compact ? "px-3 py-2.5" : "px-4 py-3";

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
        <span
          className={`block text-sm transition-colors duration-300 motion-reduce:transition-none ${
            n.read ? "text-slate-500" : "font-medium text-slate-800"
          }`}
        >
          {notificationText(n)}
        </span>
        {/* When and by whom, in that order. The icon stands in for a separator:
            two plain words in a row read as one broken phrase, and a person is
            named while the platform is not - the same way the order history
            signs its rows. */}
        <span className="mt-0.5 flex items-center gap-3 text-xs text-slate-500">
          <time dateTime={n.created_at} title={fmtDateTime(n.created_at)}>
            {fmtRecent(n.created_at)}
          </time>
          {n.actor_name && (
            <span className="flex min-w-0 items-center gap-1 text-slate-400">
              <IconUser size={13} stroke={1.8} className="shrink-0" />
              <span className="truncate">{n.actor_name}</span>
            </span>
          )}
        </span>
      </span>
    </>
  );

  const shell = `flex min-w-0 flex-1 items-start gap-3 text-left outline-none focus-visible:bg-slate-50 ${pad}`;

  return (
    // The unread stripe is always there and only changes colour: a border that
    // appears and disappears is two pixels of width, and the whole list shifted
    // sideways the moment everything was marked read. Colour, background and
    // text fade together, so reading one is a settling rather than a jump.
    <div
      className={`group/row flex items-start border-l-2 transition-colors duration-300 hover:bg-slate-50 motion-reduce:transition-none ${
        n.read ? "border-transparent" : "border-brand-500 bg-brand-50/40"
      }`}
    >
      {to ? (
        <Link to={to} onClick={() => (onRead(), onNavigate?.())} className={`${shell} cursor-pointer`}>
          {body}
        </Link>
      ) : (
        <div className={shell}>{body}</div>
      )}
      <ReadMark read={n.read} onRead={onRead} compact={compact} />
    </div>
  );
}

// The state of one notification, and the way to change it. Unread is a dot;
// hovering the row or focusing the control turns it into a tick to press. Read
// leaves nothing behind - a row of ticked-off boxes is noise, and the wording
// already goes quiet.
//
// The control stays in the tree once read, faded out and out of reach, so the
// dot dissolves with the rest of the row instead of vanishing a frame early.
function ReadMark({
  read,
  onRead,
  compact,
}: {
  read: boolean;
  onRead: () => void;
  compact: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onRead}
      disabled={read}
      aria-hidden={read}
      tabIndex={read ? -1 : undefined}
      aria-label="Отметить прочитанным"
      title={read ? undefined : "Отметить прочитанным"}
      className={`flex w-9 shrink-0 items-center justify-center self-stretch text-brand-600 outline-none transition-opacity duration-300 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 motion-reduce:transition-none ${
        read ? "pointer-events-none opacity-0" : "cursor-pointer opacity-100 hover:text-brand-800"
      } ${compact ? "py-2.5" : "py-3"}`}
    >
      {/* Two marks in one place: the dot says "unread", the tick says what
          pressing does. Only one is ever visible. */}
      <span className="relative flex h-5 w-5 items-center justify-center">
        <span className="absolute h-2 w-2 rounded-full bg-brand-600 transition-opacity group-hover/row:opacity-0 group-focus-within/row:opacity-0" />
        <IconCheck
          size={16}
          stroke={2}
          className="opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100"
        />
      </span>
    </button>
  );
}
