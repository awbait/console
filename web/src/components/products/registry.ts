import type { ComponentType } from "react";
import type { OrderRequest } from "../../api/types";
import { IngressListenersTab, IngressRoutesTab } from "./IngressGatewayPanel";

// Props every product tab receives: the request, whether the user may edit it,
// and a reload to refresh the detail after a save.
export interface ProductTabProps {
  request: OrderRequest;
  modifiable: boolean;
  reload: () => void;
}

// A product-specific tab rendered inside RequestDetailPage, between the common
// "Общая информация" and "История действий" tabs.
export interface ProductTab {
  id: string;
  label: string;
  Component: ComponentType<ProductTabProps>;
}

// Per-product detail tabs, keyed by product slug (see PRODUCT_CATEGORIES).
// A product without an entry contributes no extra tabs.
export const PRODUCT_TABS: Record<string, ProductTab[]> = {
  ingress: [
    { id: "listeners", label: "Слушатели", Component: IngressListenersTab },
    { id: "routes", label: "Маршруты", Component: IngressRoutesTab },
  ],
};
