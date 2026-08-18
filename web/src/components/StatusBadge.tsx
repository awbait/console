import {
  IconAlertTriangle,
  IconBan,
  IconCircleCheck,
  IconCircleX,
  IconDeviceFloppy,
  IconLoader2,
  IconPencil,
  IconRocket,
  IconTrash,
} from "@tabler/icons-react";
import type { ComponentType } from "react";
import type { RequestStatus } from "../api/types";

type IconType = ComponentType<{ size?: number; stroke?: number; className?: string }>;

// An order's state as the person who ordered the service reads it.
//
// The machine behind an order has eleven states (pkg/models/models.go), and four
// of them are about how the portal writes a change into Git. That is the
// portal's own business: the person on this screen wants to know whether their
// service is being saved, is coming up, works, or does not. So the states are
// grouped, every screen shows the group, and the exact state stays reachable for
// whoever has to work out why an order is where it is - in the tooltip of the
// detailed history, never in the badge.
//
// Each group keeps a distinct icon (shape, not just colour) so it is legible at
// a glance and for colour-blind users.
export type StatusGroupKey =
  | "draft"
  | "saving"
  | "deploying"
  | "healthy"
  | "broken"
  | "rejected"
  | "deleting"
  | "deleted";

interface StatusMeta {
  label: string; // human-readable (RU)
  Icon: IconType;
  fg: string; // icon/text colour
  badge: string; // pill background + text
  spin?: boolean;
  staticIcon?: IconType; // non-animated stand-in for spinning statuses (e.g. timeline)
}

const GROUP_META: Record<StatusGroupKey, StatusMeta> = {
  draft: { label: "Черновик", Icon: IconPencil, fg: "text-slate-500", badge: "bg-slate-100 text-slate-700" },
  saving: {
    label: "Сохраняем",
    Icon: IconLoader2,
    fg: "text-amber-600",
    badge: "bg-amber-100 text-amber-800",
    spin: true,
    staticIcon: IconDeviceFloppy,
  },
  deploying: {
    label: "Разворачивается",
    Icon: IconLoader2,
    fg: "text-blue-600",
    badge: "bg-blue-100 text-blue-800",
    spin: true,
    staticIcon: IconRocket,
  },
  healthy: { label: "Работает", Icon: IconCircleCheck, fg: "text-emerald-600", badge: "bg-green-100 text-green-800" },
  broken: { label: "Не работает", Icon: IconAlertTriangle, fg: "text-red-600", badge: "bg-red-100 text-red-800" },
  rejected: { label: "Отклонено", Icon: IconBan, fg: "text-slate-500", badge: "bg-slate-200 text-slate-600" },
  deleting: { label: "Удаляется", Icon: IconTrash, fg: "text-orange-600", badge: "bg-orange-100 text-orange-800" },
  deleted: { label: "Удалён", Icon: IconCircleX, fg: "text-slate-400", badge: "bg-gray-200 text-gray-600" },
};

// Which group each state falls into. The pairs that share one group are the ones
// a person cannot act on differently: a change written to Git and a change the
// delivery system has picked up are both "coming up", and a service that is ill
// and a service the cluster has lost are both "not working" - what to do next is
// the same, and the difference is a support question.
const GROUP_OF: Record<string, StatusGroupKey> = {
  DRAFT: "draft",
  MR_CREATED: "saving",
  MR_MERGED: "deploying",
  DEPLOYING: "deploying",
  HEALTHY: "healthy",
  DEGRADED: "broken",
  ARGO_MISSING: "broken",
  MR_CLOSED: "rejected",
  DELETE_REQUESTED: "deleting",
  DELETE_MR_MERGED: "deleting",
  DELETED: "deleted",
};

// The groups in lifecycle order, each with the states it covers: what a status
// filter offers, so a filter can never drift from what the badges say.
export const STATUS_GROUPS: { key: StatusGroupKey; statuses: RequestStatus[] }[] = (
  ["draft", "saving", "deploying", "healthy", "broken", "rejected", "deleting", "deleted"] as StatusGroupKey[]
).map((key) => ({
  key,
  statuses: (Object.keys(GROUP_OF) as RequestStatus[]).filter((s) => GROUP_OF[s] === key),
}));

// statusGroup is the group a state belongs to; null for a state this build does
// not know (a backend ahead of the SPA).
export function statusGroup(status: string): StatusGroupKey | null {
  return GROUP_OF[status] ?? null;
}

function metaFor(status: string): StatusMeta {
  const key = GROUP_OF[status];
  return (
    (key && GROUP_META[key]) || {
      label: status,
      Icon: IconLoader2,
      fg: "text-slate-500",
      badge: "bg-gray-100 text-gray-700",
    }
  );
}

// statusMeta exposes a status's presentation (icon, colour, label) so other
// views (e.g. the activity timeline) can render it consistently.
export function statusMeta(status: string): StatusMeta {
  return metaFor(status);
}

// What a status reads as on hover. `detailed` appends the exact state behind the
// group - for support and admin, who are the only ones offered it.
export function statusTitle(status: string, detailed?: boolean): string {
  const label = metaFor(status).label;
  return detailed && GROUP_OF[status] ? `${label} (${status})` : label;
}

export function StatusBadge({
  status,
  muted,
  noSpin,
}: {
  status: RequestStatus | string;
  muted?: boolean;
  // Disable the live spinner (e.g. in the history timeline, where a status is a
  // past record rather than the current live state).
  noSpin?: boolean;
}) {
  const m = metaFor(status);
  const Icon = noSpin && m.staticIcon ? m.staticIcon : m.Icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        muted ? "bg-slate-100 text-slate-400" : m.badge
      }`}
    >
      <Icon size={13} stroke={2} className={m.spin && !noSpin ? "animate-spin" : undefined} />
      {m.label}
    </span>
  );
}

// Status as a single colored icon (label exposed via title/aria-label). Distinct
// shapes make each status recognizable in the compact orders table.
export function StatusDot({
  status,
  size = 22,
  detailed,
}: {
  status: RequestStatus | string;
  size?: number;
  detailed?: boolean;
}) {
  const m = metaFor(status);
  const title = statusTitle(status, detailed);
  return (
    <span title={title} aria-label={title} className="inline-flex">
      <m.Icon size={size} stroke={2} className={`${m.fg} ${m.spin ? "animate-spin" : ""}`} />
    </span>
  );
}
