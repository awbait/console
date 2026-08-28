import type { User } from "../api/types";

// Whether this person can order a service at all, and what to say when they
// cannot.
//
// A service is always ordered on behalf of a team: the order carries the team
// that will own it, and the portal refuses one without a team. So somebody who
// is in no team cannot order anything, and until now the portal only said so
// after the form was filled in and sent, as "У вас нет доступа к этому разделу".
//
// Two different people arrive here and they are owed different sentences. One
// is somebody the portal recognised nothing about: no group of theirs mapped to
// a team, so they were let in with the read-only role and an empty portal. The
// other holds a platform role that is deliberately not an ordering one.

export function canOrder(user: User | null): boolean {
  return (user?.teams ?? []).length > 0;
}

export interface NoTeamNotice {
  // On the closed "Заказать" button, where there is room for a phrase.
  short: string;
  // In place of the empty list of orders.
  orders: string;
  // In place of the order form, and under the closed button.
  ordering: string;
}

// noTeamNotice returns null for anybody who can order, so a caller can write
// `const notice = noTeamNotice(user)` and let its presence be the question.
export function noTeamNotice(user: User | null): NoTeamNotice | null {
  if (canOrder(user)) return null;
  const role = user?.role;
  if (role === "admin" || role === "support" || role === "security") {
    return {
      short: "Сервисы заказывают участники команд",
      orders: "Сервисы заказывают участники команд, а ваша роль в портале другая.",
      ordering: "Сервисы заказывают участники команд, а ваша роль в портале другая.",
    };
  }
  return {
    short: "Вы не состоите ни в одной команде",
    orders:
      "Вы не состоите ни в одной команде, поэтому заказов здесь нет. Попросите администратора платформы добавить вас в команду.",
    ordering:
      "Вы не состоите ни в одной команде, поэтому заказать сервис нельзя. Попросите администратора платформы добавить вас в команду.",
  };
}
