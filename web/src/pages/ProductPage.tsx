import { Link, useParams } from "react-router-dom";
import { IconPlus, IconShoppingCart } from "@tabler/icons-react";
import { OrdersTable } from "../features/orders/OrdersTable";
import { chartLabel, findCatalogChart, useCatalog } from "../app/CatalogContext";
import { usePlatformHealth } from "../app/PlatformHealthContext";
import { LinkButton } from "../components/ui";

// Product page (= a published chart): its orders list + "Order".
// Only charts with an approved order-view appear in the menu, but a direct URL
// works for any chart - then ordering is simply unavailable.
export function ProductPage() {
  const { project = "", name = "" } = useParams();
  const { charts, loading } = useCatalog();
  const { blockedReason } = usePlatformHealth();
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
  const orderTo = orderable && !outage ? `/catalog/${project}/${name}/order` : undefined;
  // One sentence, whatever the cause behind it - a version deleted from the
  // registry, or none approved yet. Which of the two it is belongs to the
  // owner's page, not here: it is not something the reader can act on.
  const orderDisabledReason =
    outage ?? (orderableKnown && !orderable ? "Нет версий, доступных для заказа" : undefined);

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
        ) : outage ? (
          outage
        ) : orderDisabledReason ? (
          orderDisabledReason
        ) : undefined
      }
    />
  );
}
