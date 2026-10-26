// User-facing text for the admin's publication page. The wording comes from
// codex (see .claude/rules/user-facing-text.md); edit it the same way.
import { ruPlural } from "@/form/fieldErrors";

export const adminPublicationText = {
  openCatalog: "Открыть в каталоге",
  openManage: "Открыть управление сервисом",
  notFound: (chart: string) => `Публикация ${chart} не найдена.`,

  ordersLive: (n: number) =>
    `${n} ${ruPlural(n, "действующий заказ", "действующих заказа", "действующих заказов")}`,
  ordersAll: "Все заказы по сервису",

  journalTitle: "Журнал событий",
  journalEmpty: "Событий пока нет.",
  journalLoadError: "Не удалось загрузить журнал. Попробуйте ещё раз.",
  journalSystemActor: "Проверка реестра чартов",
  journalShowAll: "Показать все записи",

  event: {
    created: (category: string, team: string) =>
      `Публикация создана. Категория: ${category}. Владелец: ${team}.`,
    discovered: "Чарт найден при автоматической проверке реестра и зарегистрирован без владельца.",
    proposedCategory: (category: string) =>
      `Команда предложила новую категорию ${category}. Ждёт согласования.`,
    proposedOwner: (team: string) => `Предложена передача сервиса команде ${team}.`,
    proposalReverted: "Предложение по категории или владельцу отменено. Действуют согласованные значения.",
    submitted: "Категория и владелец отправлены на согласование.",
    withdrawn: "Изменения категории и владельца отозваны с согласования.",
    approved: "Категория и владелец согласованы.",
    appliedCategory: (category: string) => `Категория изменена на ${category}.`,
    appliedOwner: (team: string) => `Сервис передан команде ${team}.`,
    rejected: (comment: string) => `Изменения категории и владельца отклонены. Причина: ${comment}.`,
    refreshed: (n: number) => `Чарт перечитан из реестра. Версий: ${n} ${ruPlural(n, "версия", "версии", "версий")}.`,
    adopted: (team: string, category: string) => `Сервис принят командой ${team}. Категория: ${category}.`,
    versionUpdated: (v: string) => `Документ версии ${v} сохранён.`,
    versionSubmitted: (v: string) => `Версия ${v} отправлена на согласование.`,
    versionWithdrawn: (v: string) => `Версия ${v} отозвана с согласования.`,
    versionApproved: (v: string) => `Версия ${v} согласована.`,
    versionRejected: (v: string, comment: string) => `Версия ${v} отклонена. Причина: ${comment}.`,
    versionOrderable: (v: string) => `Версия ${v} открыта для заказа в каталоге.`,
    versionNotOrderable: (v: string) => `Версия ${v} убрана из каталога.`,
    versionRecommended: (v: string) => `Версия ${v} сделана рекомендуемой.`,
    versionDeprecated: (v: string) => `Версия ${v} снята с поддержки.`,
    versionDeprecatedNote: (v: string, note: string) => `Версия ${v} снята с поддержки. Причина: ${note}.`,
    versionHidden: (v: string) => `Версия ${v} скрыта из списка.`,
    versionUndeprecated: (v: string) => `Версия ${v} возвращена в поддержку.`,
    versionUnhidden: (v: string) => `Версия ${v} снова показана в списке.`,
    unknown: (type: string) => `Неизвестное событие: ${type}.`,
  },

  adminPendingHint:
    "Команда отправила смену категории или владельца на согласование. Решение принимается на странице «Публикации» в админке.",
  adminPendingLink: "Открыть публикации в админке",
};
