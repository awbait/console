import { Link, useParams } from "react-router-dom";
import { IconPlus, IconShoppingCart } from "@tabler/icons-react";
import { OrdersTable } from "../features/orders/OrdersTable";
import { chartLabel, findCatalogChart, useCatalog } from "../app/CatalogContext";
import { usePlatformHealth } from "../app/PlatformHealthContext";
import { noTeamNotice } from "../auth/access";
import { useUser } from "../auth/UserContext";
import { LinkButton } from "../components/ui";

// Product page (= a published chart): its orders list + "Order".
// Only charts with an approved order-view appear in the menu, but a direct URL
// works for any chart - then ordering is simply unavailable.
export function ProductPage() {
  const { project = "", name = "" } = useParams();
  const { charts, loading } = useCatalog();
  const { blockedReason } = usePlatformHealth();
  const { user } = useUser();
  // Somebody in no team cannot order this or anything else, and no waiting or
  // approval changes that - so it outranks both reasons below and the button is
  // closed with it before the page is even about this product.
  const noTeam = noTeamNotice(user);
  const chart = findCatalogChart(charts, project, name);
  const label = chartLabel(name);
  // An outage outranks the per-chart rules below: the form may be approved and
  // still lead nowhere while the platform cannot open a merge request.
  const outage = blockedReason("ordering");

  if (!loading && !chart) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Чарт {project}/{name} не найден в каталоге.{" "}
        <Link to="/catalog" className="underline">
          К каталогу
        </Link>
        .
      </div>
    );
  }

  // Ordering is available when the order-view is approved. While the catalog
  // loads, show no button and no false "unavailable".
  const orderableKnown = !!chart;
  const orderable = !!chart?.publication?.published && !!chart?.publication?.has_order_view;
  const orderTo =
    orderable && !outage && !noTeam ? `/catalog/${project}/${name}/order` : undefined;
  // One sentence, whatever the cause behind it - a version deleted from the
  // registry, or none approved yet. Which of the two it is belongs to the
  // owner's page, not here: it is not something the reader can act on.
  const orderDisabledReason =
    noTeam?.short ??
    outage ??
    (orderableKnown && !orderable ? "Нет версий, доступных для заказа" : undefined);

  return (
    <OrdersTable
      title={label}
      filter={(r) => r.chart_project === project && r.chart_name === name}
      orderTo={orderTo}
      orderDisabledReason={orderDisabledReason}
      emptyHint={
        orderTo ? (
          <div className="flex flex-col items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <IconShoppingCart size={24} stroke={1.6} />
            </span>
            <p>Заказов пока нет</p>
            <LinkButton to={orderTo} className="gap-1.5">
              <IconPlus size={16} stroke={1.7} className="text-slate-400" />
              Заказать
            </LinkButton>
          </div>
        ) : noTeam ? (
          noTeam.ordering
        ) : outage ? (
          outage
        ) : orderDisabledReason ? (
          orderDisabledReason
        ) : undefined
      }
    />
  );
}
