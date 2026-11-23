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
  // Security is not here: its teams count like anybody else's, so the advice to
  // ask for a team is the right one for it too.
  if (role === "admin" || role === "support") {
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

// OrderPage serves three flows: placing a new order (needs a team to own it),
// editing an existing draft (already belongs to a team), and upgrading a live
// order (same). Only a brand-new order requires team membership; platform roles
// (admin, support) without teams can still edit drafts and upgrade orders.
export function orderFormBlocked(user: User | null, editing: boolean): NoTeamNotice | null {
  return editing ? null : noTeamNotice(user);
}

// Which team owns the order on OrderPage: the order's own team when editing or
// upgrading an existing request, and the topbar active team for a new order.
export function orderFormTeam(
  editing: boolean,
  draftTeam: string | undefined,
  activeTeam: string | null,
): string {
  return (editing ? draftTeam : activeTeam) ?? "";
}
