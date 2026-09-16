import type { CatalogChart, User } from "../../api/types";
import { isUnclaimed } from "../../api/types";
import { canModify } from "../../auth/UserContext";

export function isOrderableChart(chart: CatalogChart): boolean {
  const pub = chart.publication;
  return !chart.missing && !!pub?.published && (!!pub.has_order_view || !!pub.orderable_versions?.length);
}

// Match the manage entry point on the service detail page, including adoption.
export function canManageChart(chart: CatalogChart, user: User | null): boolean {
  const canPublish = user?.role === "admin" || !!user?.teams?.length;
  const pub = chart.publication;
  return pub ? canModify(user, pub.owner_team) || (isUnclaimed(pub) && canPublish) : canPublish;
}

export function catalogVersion(chart: CatalogChart): string {
  const pub = chart.publication;
  return (
    (isOrderableChart(chart) &&
      (pub?.recommended_version || pub?.orderable_versions?.[0] || pub?.approved_view_version)) ||
    chart.latest_version
  );
}

export function catalogDescription(chart: CatalogChart): string {
  return (isOrderableChart(chart) && chart.publication?.approved_description) || chart.description;
}

export function publicationState(chart: CatalogChart): {
  label: string;
  tone: "neutral" | "warning" | "danger";
} {
  const pub = chart.publication;
  if (chart.missing || (pub?.gone_versions?.length && !pub.published))
    return { label: "Нет в Harbor", tone: "danger" };
  if (pub?.deprecated_versions?.length && !pub.published)
    return { label: "Снят с поддержки", tone: "neutral" };
  if (pub?.status === "PENDING") return { label: "На согласовании", tone: "warning" };
  if (pub?.status === "REJECTED") return { label: "Нужны изменения", tone: "danger" };
  if (!pub || isUnclaimed(pub)) return { label: "Не опубликован", tone: "neutral" };
  if (pub.published && !isOrderableChart(chart)) return { label: "Нет формы заказа", tone: "warning" };
  if (pub.status === "APPROVED") return { label: "Не опубликован", tone: "neutral" };
  return { label: "Черновик", tone: "neutral" };
}
