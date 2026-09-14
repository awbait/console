// Shared icon helpers for categories and published charts.

import type { ComponentType } from "react";
import { findCatalogChart, useCatalog } from "../app/CatalogContext";
import { categoryGlyphs } from "./CategoryIcons";
import "./sidebar.css";

// Common shape of a Tabler icon component (size/stroke/className props).
export type TablerIcon = ComponentType<{ size?: number | string; stroke?: number; className?: string }>;

// Category icon palette: the admin picks one of these by slug (stored on the
// category in the DB); icons are pure cosmetics. Keep the keys stable - they are
// persisted. The "platform"/"databases"/"network" aliases keep older categories
// (seeded before the icon field) showing a sensible icon until re-picked.
const CATEGORY_ICON_BY_NAME: Record<string, TablerIcon> = {
  ...categoryGlyphs,
  // legacy id aliases (pre-icon-field categories)
  platform: categoryGlyphs.stack,
  databases: categoryGlyphs.database,
  uncategorized: categoryGlyphs.tag,
};

// CATEGORY_ICON_CHOICES drives the icon picker (the real palette, without the
// legacy id aliases).
export const CATEGORY_ICON_CHOICES: { id: string; Icon: TablerIcon }[] = [
  "box",
  "tag",
  "stack",
  "database",
  "network",
  "server",
  "cloud",
  "shield",
  "lock",
  "key",
  "chart",
  "bucket",
  "cpu",
  "apps",
  "messages",
].map((id) => ({ id, Icon: CATEGORY_ICON_BY_NAME[id] }));

export function categoryIconName(name: string, categoryId?: string): string {
  // Existing installations seeded the built-in category with the generic box.
  if (categoryId === "uncategorized" && (!name || name === "box")) return "tag";
  return name;
}

// Resolve persisted icon names, with the generic box for unknown names.
export function categoryIcon(name: string, categoryId?: string): TablerIcon {
  return CATEGORY_ICON_BY_NAME[categoryIconName(name, categoryId)] ?? categoryGlyphs.box;
}

// ProductIcon renders a chart's own icon (Chart.yaml `icon` -> icon_url). When the
// chart has no icon it falls back to the admin-chosen icon of the chart's category,
// then to a neutral box. The chart is resolved from the shared catalog by its
// coordinates, so callers pass only project/name (an order knows both).
export function ProductIcon({
  project,
  name,
  size = 18,
  className = "",
}: {
  project: string;
  name: string;
  size?: number;
  className?: string;
}) {
  const { charts, categories } = useCatalog();
  const chart = findCatalogChart(charts, project, name);
  const pub = chart?.publication;
  // Approved charts show the icon snapshot from approve time (like the catalog);
  // others show the live Chart.yaml icon. An empty snapshot deliberately falls
  // through to the category icon rather than leaking a newer version's icon.
  const approved = !!pub?.published && !!pub?.has_order_view;
  const iconUrl = approved ? pub?.approved_icon_url : chart?.icon_url;
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt=""
        width={size}
        height={size}
        className={`shrink-0 rounded object-contain ${className}`}
      />
    );
  }
  const category = categories.find((c) => c.id === pub?.category_id);
  const Icon = categoryIcon(category?.icon ?? "", category?.id ?? pub?.category_id);
  return <Icon size={size} stroke={1.7} className={`shrink-0 ${className}`} />;
}
