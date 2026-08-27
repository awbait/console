import {
  IconAlertTriangle,
  IconBan,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconLoader2,
  IconPencil,
  IconRocket,
  IconTrash,
} from "@tabler/icons-react";
import type { ComponentType } from "react";
import type { RequestStatus } from "../api/types";
import { StatusPill } from "./ui";

type IconType = ComponentType<{ size?: number; stroke?: number; className?: string }>;

// An order's state as the person who ordered the service reads it.
//
// The machine behind an order has eleven states (pkg/models/models.go), and four
// of them are about how the portal writes a change into Git. That is the
// portal's own business: the person on this screen wants to know whether their
// order was taken, the service is coming up, works, or does not. So the states are
// grouped, every screen shows the group, and the exact state stays reachable for
// whoever has to work out why an order is where it is - in the tooltip of the
// detailed history, never in the badge.
//
// Each group keeps a distinct icon (shape, not just colour) so it is legible at
// a glance and for colour-blind users.
export type StatusGroupKey =
  | "draft"
  | "accepted"
  | "deploying"
  | "healthy"
  | "broken"
  | "rejected"
  | "deleting"
  | "deleted";

interface StatusMeta {
  label: string; // human-readable (RU)
  // One line of what the state means, for the legend: the label names the
  // state, this says what it means for the service.
  note: string;
  Icon: IconType;
  fg: string; // icon/text colour
  badge: string; // pill background + text
  spin?: boolean;
  staticIcon?: IconType; // non-animated stand-in for spinning statuses (e.g. timeline)
}

// Every label names the service (or the order the person sent), never what the
// portal is doing about it: "Сохраняем" told a person who was waiting for a
// service that some file was being written.
const GROUP_META: Record<StatusGroupKey, StatusMeta> = {
  draft: {
    label: "Черновик",
    note: "Заказ создан, но ещё не отправлен.",
    Icon: IconPencil,
    fg: "text-slate-500",
    badge: "bg-slate-100 text-slate-700",
  },
  // No spinner here: an accepted order can wait for a person to read it, and a
  // spinner that turns for an hour promises progress that is not happening.
  accepted: {
    label: "Принят",
    note: "Заказ отправлен, сервиса в кластере ещё нет.",
    Icon: IconClock,
    fg: "text-amber-600",
    badge: "bg-amber-100 text-amber-800",
  },
  deploying: {
    label: "Разворачивается",
    note: "Платформа приводит кластер к заказанному состоянию.",
    Icon: IconLoader2,
    fg: "text-blue-600",
    badge: "bg-blue-100 text-blue-800",
    spin: true,
    staticIcon: IconRocket,
  },
  healthy: {
    label: "Работает",
    note: "Сервис развёрнут и работает без ошибок.",
    Icon: IconCircleCheck,
    fg: "text-emerald-600",
    badge: "bg-green-100 text-green-800",
  },
  broken: {
    label: "Не работает",
    note: "Сервис развёрнут с ошибкой или его нет в кластере.",
    Icon: IconAlertTriangle,
    fg: "text-red-600",
    badge: "bg-red-100 text-red-800",
  },
  rejected: {
    label: "Отклонён",
    note: "Изменение отменили, портал его не применил.",
    Icon: IconBan,
    fg: "text-slate-500",
    badge: "bg-slate-200 text-slate-600",
  },
  deleting: {
    label: "Удаляется",
    note: "Сервис убирается из кластера.",
    Icon: IconTrash,
    fg: "text-orange-600",
    badge: "bg-orange-100 text-orange-800",
  },
  deleted: {
    label: "Удалён",
    note: "Сервиса больше нет.",
    Icon: IconCircleX,
    fg: "text-slate-400",
    badge: "bg-gray-200 text-gray-600",
  },
};

// Which group each state falls into. The pairs that share one group are the ones
// a person cannot act on differently: a change written to Git and a change the
// delivery system has picked up are both "coming up", and a service that is ill
// and a service the cluster has lost are both "not working" - what to do next is
// the same, and the difference is a support question.
const GROUP_OF: Record<string, StatusGroupKey> = {
  DRAFT: "draft",
  MR_CREATED: "accepted",
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
  ["draft", "accepted", "deploying", "healthy", "broken", "rejected", "deleting", "deleted"] as StatusGroupKey[]
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
      // The legend is drawn from the groups, so an ungrouped state never gets
      // there and has nothing to say beyond its own name.
      note: "",
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

// A state the order does not leave on its own, and what the person looking at it
// can do about it. Everything else either moves on by itself or has a button on
// the page saying what to press, so only the dead ends are listed here.
export interface NextStep {
  title: string;
  hint: string;
}

const NEXT_STEP: Record<string, NextStep> = {
  DEGRADED: {
    title: "Сервис развёрнут, но работает с ошибками",
    hint: "Само это не исправится. Напишите в поддержку платформы и пришлите ссылку на эту страницу.",
  },
  ARGO_MISSING: {
    title: "Сервиса нет в кластере",
    hint: "Заказ есть, а сервиса в кластере нет. Напишите в поддержку платформы и пришлите ссылку на эту страницу.",
  },
  MR_CLOSED: {
    title: "Заказ отклонён",
    hint: "Изменение отменили, и портал его не применил. Отправьте заказ заново или напишите в поддержку платформы.",
  },
};

// statusNextStep is what to do next, or null when the state speaks for itself.
// deleteCancelled marks the one MR_CLOSED that is not a rejected order: a
// deletion someone called off, where the service is still running.
export function statusNextStep(status: string, deleteCancelled = false): NextStep | null {
  if (status === "MR_CLOSED" && deleteCancelled) {
    return {
      title: "Удаление отменено",
      hint: "Сервис работает, но портал больше не принимает изменения по этому заказу. Напишите в поддержку платформы.",
    };
  }
  return NEXT_STEP[status] ?? null;
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
    <StatusPill tone={muted ? "bg-slate-100 text-slate-400" : m.badge} Icon={Icon} spin={m.spin && !noSpin}>
      {m.label}
    </StatusPill>
  );
}
