// What a notification says, in the portal's own words.
//
// The server sends what happened and the facts it happened to; the sentence is
// written here. That is the same rule the rest of the product's text follows
// (see api/errorText.ts and form/fieldErrors.ts): the wording lives in one
// place, can be rewritten without a migration, and never freezes into rows
// stored months ago.
//
// A notification is one line: what happened, to what. Anything longer belongs
// on the page it links to.

import type { AppNotification } from "@/api/types";
import { mergeBlockReason } from "@/features/orders/mergeBlock";
import { ruPlural } from "@/form/fieldErrors";
import { releaseAnchor } from "@/lib/release";

// Что именно перестало работать в настройке портала. Здесь только заголовок:
// что с этим делать, написано на странице «Конфигурация», куда ведёт
// уведомление, и повторять это в одну строку не нужно.
const CONFIG_BROKE: Record<string, string> = {
  "gitlab_token.expired": "Токен GitLab истёк",
  "gitlab_token.revoked": "Токен GitLab отозван",
  "gitlab_webhook.hook_disabled": "GitLab отключил вебхук портала",
  "gitlab_webhook.secret_mismatch": "GitLab отклоняет все уведомления: секрет не совпадает",
  "harbor_webhook.secret_mismatch": "Harbor отклоняет все уведомления: секрет не совпадает",
  "harbor_projects.projects_missing": "В Harbor пропал проект из списка",
  "harbor_projects.projects_hidden": "Проект Harbor больше не виден порталу",
  "argocd_project.project_missing": "В Argo CD пропал проект портала",
  "argocd_cluster.cluster_missing": "В Argo CD пропал кластер портала",
};

// Как назвать проверку, когда она снова в порядке. Отбой читают через несколько
// дней после самой поломки, и «проверка gitlab_token» к тому времени ничего не
// напоминает.
const CONFIG_SUBJECT: Record<string, string> = {
  gitlab_token: "Токен GitLab",
  gitlab_webhook: "Вебхук GitLab",
  harbor_webhook: "Уведомления из Harbor",
  harbor_projects: "Проекты Harbor",
  argocd_project: "Проект портала в Argo CD",
  argocd_cluster: "Кластер портала в Argo CD",
};

// str reads a payload field as text. The payload is JSON from the server, and a
// missing field is a notification worth showing anyway - with a little less in
// it - rather than a blank row.
function str(n: AppNotification, key: string): string {
  const v = n.payload?.[key];
  return typeof v === "string" ? v : "";
}

function bool(n: AppNotification, key: string): boolean {
  return n.payload?.[key] === true;
}

// A notification is a headline, and a headline carries no full stop. A comment
// quoted inside one keeps its own punctuation - it is somebody's sentence, not
// ours.
export function notificationText(n: AppNotification): string {
  const service = str(n, "service_name") || str(n, "chart_name") || "сервис";
  switch (n.kind) {
    case "order_healthy":
      return bool(n, "recovered")
        ? `Сервис ${service} снова работает`
        : `Сервис ${service} развёрнут и работает`;
    case "order_degraded":
      return `Сервис ${service} не работает`;
    case "order_change_blocked": {
      const why = mergeBlockReason(str(n, "reason"));
      return why
        ? `Изменение сервиса ${service} не удалось применить: ${why}`
        : `Изменение сервиса ${service} не удалось применить`;
    }
    case "chart_version_available":
      return `Для сервиса ${str(n, "chart_name")} вышла версия ${str(n, "chart_version")}, опишите её и отправьте на согласование`;
    case "version_approved":
      return `Версия ${str(n, "chart_version")} сервиса ${str(n, "chart_name")} согласована`;
    case "version_rejected": {
      const comment = str(n, "comment");
      const head = `Версия ${str(n, "chart_version")} сервиса ${str(n, "chart_name")} отклонена`;
      return comment ? `${head}: ${comment}` : head;
    }
    case "chart_version_missing":
      return `Версия ${str(n, "chart_version")} сервиса ${str(n, "chart_name")} пропала из реестра, заказать её больше нельзя`;
    case "version_submitted":
      return `Версия ${str(n, "chart_version")} сервиса ${str(n, "chart_name")} ждёт согласования`;
    case "chart_discovered":
      return `В реестре найден сервис ${str(n, "chart_name")}, задайте ему категорию и владельца`;
    case "order_delete_stalled":
      return `Сервис ${service} не удалился до конца, проверьте, что осталось в кластере`;
    case "portal_updated":
      return `Портал обновлён до версии ${str(n, "version")}`;
    case "config_check_failed":
      return configBrokeText(n);
    case "config_check_recovered": {
      const subject = CONFIG_SUBJECT[str(n, "check")];
      return subject ? `${subject} снова в порядке` : "Настройка портала снова в порядке";
    }
    default:
      // A kind this build does not know: the portal is newer on the server than
      // in this browser. Saying so is better than an empty row.
      return "Что-то произошло, но эта версия портала не знает, как об этом рассказать";
  }
}

// Срок токена - единственная поломка, о которой портал говорит дважды: за месяц
// и за неделю. Поэтому она и звучит по-разному: «истекает через 25 дней» и
// «истекает через 5 дней» - это разные новости, а «скоро истечёт» дважды
// читается как повтор.
function configBrokeText(n: AppNotification): string {
  const check = str(n, "check");
  const reason = str(n, "reason");
  if (check === "gitlab_token" && reason === "expires_soon") {
    const days = typeof n.payload?.days_left === "number" ? n.payload.days_left : null;
    if (days === null) return "Срок токена GitLab скоро истечёт";
    if (days <= 0) return "Токен GitLab истекает сегодня";
    return `Токен GitLab истекает через ${days} ${ruPlural(days, "день", "дня", "дней")}`;
  }
  return CONFIG_BROKE[`${check}.${reason}`] ?? "Что-то в настройке портала перестало работать";
}

// Where a notification leads. Built from what it is about, never stored: routes
// change, and a saved link rots quietly in an old row.
export function notificationLink(n: AppNotification): string | null {
  const enc = encodeURIComponent;
  // The portal's own update leads to its changelog, at the section that
  // describes the build now running. Between releases that is "Ещё не
  // выпущено": a build stamped "v0.4.0-10-g2574d9b" is exactly what has been
  // merged since 0.4.0.
  if (n.kind === "portal_updated") {
    return `/about#${releaseAnchor(str(n, "version"))}`;
  }
  // Настройка читается на своей странице: там же видно, что именно портал
  // увидел, и что с этим делать.
  if (n.kind === "config_check_failed" || n.kind === "config_check_recovered") {
    return "/admin/config";
  }
  // A version waiting for approval leads to where the decision is made, not to
  // where the version is written: this one is addressed to admins, and their
  // page is the review page.
  if (n.kind === "version_submitted") {
    const project = str(n, "chart_project");
    const name = str(n, "chart_name");
    const version = str(n, "chart_version");
    if (!project || !name || !version) return null;
    return `/admin/approvals/${enc(project)}/${enc(name)}/${enc(version)}`;
  }
  switch (n.subject_type) {
    case "order":
      return n.subject_id ? `/requests/${enc(n.subject_id)}` : null;
    case "publication":
    case "version": {
      // A version is addressed by its chart, not by the id of the publication
      // row: that is how the pages are routed, and the payload carries both
      // halves for exactly this.
      const project = str(n, "chart_project");
      const name = str(n, "chart_name");
      if (!project || !name) return null;
      const version = str(n, "chart_version");
      const base = `/catalog/${enc(project)}/${enc(name)}/manage`;
      return version ? `${base}/${enc(version)}` : base;
    }
    default:
      return null;
  }
}
