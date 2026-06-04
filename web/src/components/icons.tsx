// Shared icon helpers built on @tabler/icons-react.
import type { ComponentType } from "react";
import {
  IconBox,
  IconBrandMongodb,
  IconBrandMysql,
  IconBucket,
  IconChartLine,
  IconDatabase,
  IconNetwork,
  IconServer,
  IconStack2,
  IconStack3,
} from "@tabler/icons-react";

// Common shape of a Tabler icon component (size/stroke/className props).
export type TablerIcon = ComponentType<{ size?: number | string; stroke?: number; className?: string }>;

// Static product taxonomy for the sidebar (placeholder until a real one exists).
// A product optionally maps to a catalog chart (project/name) for ordering.
export interface ProductDef {
  slug: string;
  label: string;
  chart?: { project: string; name: string };
  // Static JSON Schema filename under /public/schemas/ used to render the order
  // form (until the product maps to a real Harbor chart).
  schema?: string;
}
export interface CategoryDef {
  id: string;
  label: string;
  Icon: TablerIcon;
  products: ProductDef[];
}

export const PRODUCT_CATEGORIES: CategoryDef[] = [
  {
    id: "platform",
    label: "Платформа",
    Icon: IconStack3,
    products: [{ slug: "namespace", label: "Namespace" }],
  },
  {
    id: "databases",
    label: "Базы данных",
    Icon: IconDatabase,
    products: [{ slug: "postgresql", label: "PostgreSQL", chart: { project: "platform", name: "postgres" } }],
  },
  {
    id: "network",
    label: "Сеть",
    Icon: IconNetwork,
    products: [
      { slug: "ingress", label: "Ingress Gateway", chart: { project: "platform", name: "ingress-gateway" } },
      { slug: "egress", label: "Egress Gateway" },
      { slug: "policies", label: "Policies" },
    ],
  },
];

export function findProduct(slug: string): ProductDef | undefined {
  for (const cat of PRODUCT_CATEGORIES) {
    const p = cat.products.find((x) => x.slug === slug);
    if (p) return p;
  }
  return undefined;
}

// Reverse lookup: the product mapped to a given catalog chart (project/name).
// Used to seed a friendly default (e.g. "Ingress Gateway") on the order form.
export function findProductByChart(project: string, name: string): ProductDef | undefined {
  for (const cat of PRODUCT_CATEGORIES) {
    const p = cat.products.find((x) => x.chart?.project === project && x.chart?.name === name);
    if (p) return p;
  }
  return undefined;
}

// Reverse lookup: the sidebar category (taxonomy) a chart belongs to — so the
// "Категория" column reflects the left-menu grouping (e.g. "Сеть") instead of the
// raw Harbor project. Returns undefined for charts not placed in the taxonomy.
export function findCategoryByChart(project: string, name: string): CategoryDef | undefined {
  return PRODUCT_CATEGORIES.find((cat) =>
    cat.products.some((x) => x.chart?.project === project && x.chart?.name === name),
  );
}

// Map a chart/product name to a Tabler icon (brand where available, else by kind).
const PRODUCT_ICON: Record<string, TablerIcon> = {
  postgres: IconDatabase,
  postgresql: IconDatabase,
  redis: IconDatabase,
  clickhouse: IconDatabase,
  elasticsearch: IconDatabase,
  mongo: IconBrandMongodb,
  mongodb: IconBrandMongodb,
  mysql: IconBrandMysql,
  mariadb: IconBrandMysql,
  kafka: IconStack2,
  rabbitmq: IconStack2,
  nginx: IconServer,
  grafana: IconChartLine,
  prometheus: IconChartLine,
  minio: IconBucket,
};

function iconFor(name: string): TablerIcon {
  const n = name.toLowerCase();
  for (const key of Object.keys(PRODUCT_ICON)) {
    if (n.includes(key)) return PRODUCT_ICON[key];
  }
  return IconBox;
}

export function ProductIcon({
  name,
  size = 18,
  className = "",
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const Icon = iconFor(name);
  return <Icon size={size} stroke={1.7} className={`shrink-0 ${className}`} />;
}
