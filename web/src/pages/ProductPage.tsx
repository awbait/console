import { Link, useParams } from "react-router-dom";
import { OrdersTable } from "../components/OrdersTable";
import { findProduct } from "../components/icons";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";

export function ProductPage() {
  const { slug = "" } = useParams();
  const product = findProduct(slug);

  // A product may map to a Harbor chart living at an arbitrary project/name
  // (declared in icons.tsx). Verify it actually exists in the registry before
  // offering "Заказать" — otherwise the order form would 404 on the missing
  // chart. Hooks run unconditionally (before the early return below).
  const mapped = product?.chart;
  const { data: chart, error: chartErr, loading: chartLoading } = useAsync(
    () => (mapped ? api.getChart(mapped.project, mapped.name) : Promise.resolve(null)),
    [mapped?.project, mapped?.name],
  );

  if (!product) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Неизвестный продукт. <Link to="/requests" className="underline">К списку заказов</Link>.
      </div>
    );
  }

  // Chart confirmed present in the registry.
  const chartReady = !!mapped && !!chart && !chartErr;
  // Order route: a confirmed Harbor chart, or (for chart-less products) a
  // static-schema form.
  const orderTo = chartReady
    ? `/catalog/${mapped!.project}/${mapped!.name}/order`
    : !mapped && product.schema
      ? `/products/${product.slug}/order`
      : undefined;
  // A mapped chart that isn't (yet) in the registry: disable ordering and say so.
  const orderDisabledReason =
    mapped && !chartLoading && !chartReady
      ? `Чарт ${mapped.project}/${mapped.name} отсутствует в реестре`
      : undefined;

  return (
    <OrdersTable
      title={product.label}
      // Show only orders of this product's chart (schema-only products have none yet).
      filter={(r) => !!mapped && r.chart_name === mapped.name && r.chart_project === mapped.project}
      orderTo={orderTo}
      orderDisabledReason={orderDisabledReason}
      emptyHint={
        orderTo ? (
          <>Заказов {product.label} пока нет — нажмите «Заказать».</>
        ) : orderDisabledReason ? (
          <>{orderDisabledReason}. Заказ недоступен, пока чарт не опубликован.</>
        ) : (
          <>Продукт «{product.label}» пока недоступен для заказа.</>
        )
      }
    />
  );
}
