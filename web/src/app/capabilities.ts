// What the portal can do, in the words the user reads.
//
// The backend reports health as capability ids (internal/status/capabilities.go)
// and never as component names: "harbor is down" means nothing to the person
// waiting to order a service. The sentences live here, next to the rest of the
// product copy (see api/errorText.ts), and every screen that has to explain an
// outage - the banner, the topbar popover, a disabled button, the sign-in
// screen - takes its wording from this one table.

export type CapabilityId =
  | "sign_in"
  | "catalog"
  | "ordering"
  | "orders"
  | "deploy_status"
  | "publishing";

export interface CapabilityText {
  // Name of the capability, as a short noun phrase for a list.
  label: string;
  // What its outage costs the user, and what still works despite it. One
  // sentence, addressed to the reader.
  impact: string;
}

export const CAPABILITIES: Record<CapabilityId, CapabilityText> = {
  sign_in: {
    label: "Вход в портал",
    impact: "Войти сейчас не получится.",
  },
  catalog: {
    label: "Каталог сервисов",
    impact: "Каталог сейчас не открывается. Заказанные сервисы работают как обычно.",
  },
  ordering: {
    label: "Заказ сервисов",
    impact: "Заказать или изменить сервис сейчас не получится. Созданные заказы открываются как обычно.",
  },
  orders: {
    label: "Список заказов",
    impact: "Список заказов сейчас не открывается.",
  },
  deploy_status: {
    label: "Статусы заказов",
    impact: "Статус заказанных сервисов сейчас не обновляется и может быть неактуальным.",
  },
  publishing: {
    label: "Публикация сервисов",
    impact: "Опубликовать сервис или отправить версию на согласование сейчас не получится.",
  },
};

// Wording for one capability. An id the backend knows about and this table does
// not (a new capability shipped ahead of the front end) still gets an honest
// sentence instead of a raw identifier on screen.
export function capabilityText(id: string): CapabilityText {
  return (
    CAPABILITIES[id as CapabilityId] ?? {
      label: "Часть портала",
      impact: "Эта часть портала сейчас недоступна.",
    }
  );
}
