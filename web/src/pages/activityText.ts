import type { ActivityEvent } from "@/api/types";

// What a person did, in words. The backend sends what happened (`event_type`)
// and what it happened to, the same way notifications do, and the sentence is
// composed here next to the rest of the product's text.
//
// The two journals name some of their events alike ("created" is an ordered
// service in one and a registered chart in the other), so the wording is keyed
// by source as well as by type.

const ORDER_ACTIONS: Record<string, string> = {
  created: "заказал сервис",
  draft_created: "создал черновик",
  draft_updated: "изменил черновик",
  draft_discarded: "удалил черновик",
  renamed: "переименовал сервис",
  deleted: "удалил сервис",
  git_pulled: "принял изменения из Git",
  imported: "взял сервис из Git под управление",
  sync_forced: "запустил синхронизацию",
  status_changed: "изменил состояние заказа",
  merge_blocked: "остановил изменение до решения человека",
  merge_retried: "пересобрал изменение",
};

const PUBLICATION_ACTIONS: Record<string, string> = {
  created: "зарегистрировал сервис в каталоге",
  updated: "изменил карточку сервиса",
  submitted: "отправил публикацию на согласование",
  withdrawn: "отозвал публикацию с согласования",
  approved: "согласовал публикацию",
  rejected: "отклонил публикацию",
  adopted: "взял сервис под управление",
  discovered: "нашёл сервис в реестре",
  version_updated: "изменил версию",
  version_submitted: "отправил версию на согласование",
  version_withdrawn: "отозвал версию",
  version_approved: "согласовал версию",
  version_rejected: "отклонил версию",
  version_orderable: "изменил доступность версии для заказа",
  version_recommended: "выбрал рекомендуемую версию",
};

// actionText is the verb phrase of one event. An event the portal has learned
// to write but nobody has worded yet falls back to its own name: an unlabelled
// row is still evidence that something happened.
export function actionText(e: Pick<ActivityEvent, "source" | "event_type">): string {
  const table = e.source === "publication" ? PUBLICATION_ACTIONS : ORDER_ACTIONS;
  return table[e.event_type] ?? e.event_type;
}

// personName is who to print. The portal records the name with the event, but
// an old row may carry only an OIDC subject, and that is still better than an
// empty cell.
export function personName(name: string, fallback: string): string {
  return name.trim() || fallback;
}

// initials are the one or two letters shown in place of an avatar. The portal
// has no photographs and does not want any.
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// seenAgo words the freshness of presence. Seconds are what the backend sends,
// because "online" here means "asked us for something recently" and the page
// should say so rather than imply the person is sitting there.
export function seenAgo(seconds: number | undefined): string {
  const s = seconds ?? 0;
  if (s < 60) return "только что";
  const min = Math.floor(s / 60);
  return `${min} мин назад`;
}
