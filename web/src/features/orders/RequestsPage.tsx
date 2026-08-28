import { IconUsersGroup } from "@tabler/icons-react";
import { noTeamNotice } from "@/auth/access";
import { useUser } from "@/auth/UserContext";
import { OrdersTable } from "./OrdersTable";

export function RequestsPage() {
  const { user } = useUser();
  // The list is empty for two very different reasons and used to look the same
  // for both: a team that has not ordered anything yet, and a person the portal
  // put in no team at all. The second one is told what happened here, on the
  // first screen they land on, instead of being offered the catalog.
  const notice = noTeamNotice(user);

  return (
    <OrdersTable
      title="Список заказов"
      emptyHint={
        notice ? (
          <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <IconUsersGroup size={24} stroke={1.6} />
            </span>
            <p>{notice.orders}</p>
          </div>
        ) : undefined
      }
    />
  );
}
