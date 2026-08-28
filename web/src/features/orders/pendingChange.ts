import { IconClock, IconDeviceFloppy, type TablerIcon } from "@tabler/icons-react";
import type { OrderReview } from "@/api/types";

// What the order page says while a change of the service is on its way.
//
// Two different waits used to be told as one. Where the portal applies changes
// itself - which is most services - nobody reads anything and the wait is a
// matter of seconds. Where the service asks for a person, or the whole portal
// does, the order sits there until somebody reads it, and the page owes the
// reader that fact plus the one thing they want to know: whether it is on them.
//
// Both cases end with the same restriction, because it holds either way: a
// second change cannot start while one is in flight.
export interface PendingChangeNotice {
  title: string;
  hint: string;
  Icon: TablerIcon;
}

const REVIEW_TITLE: Record<string, string> = {
  create: "Заказ ждёт проверки",
  update: "Изменение ждёт проверки",
  delete: "Удаление ждёт проверки",
};

// action is the merge request's action (create/update/delete); review comes from
// the order and is absent on a backend that predates it, which reads as "nobody
// is waiting" - what the page said before it existed.
export function pendingChangeNotice(action?: string, review?: OrderReview): PendingChangeNotice {
  if (!review?.required) {
    return {
      title: "Изменение сервиса сохраняется",
      hint: "Пока оно не применится, менять, обновлять и удалять сервис нельзя.",
      Icon: IconDeviceFloppy,
    };
  }
  const who =
    review.by === "installation"
      ? "В этом портале каждое изменение читает человек."
      : "Изменения этого сервиса читает человек.";
  return {
    title: REVIEW_TITLE[action ?? ""] ?? REVIEW_TITLE.update,
    hint: `${who} От вас ничего не нужно. Пока идёт проверка, менять, обновлять и удалять сервис нельзя.`,
    Icon: IconClock,
  };
}
