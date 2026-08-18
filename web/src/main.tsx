import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from "react-router-dom";
import "./index.css";
import "./lib/monaco";
import { CatalogProvider } from "./app/CatalogContext";
import { NotificationsProvider } from "./app/NotificationsContext";
import { PlatformHealthProvider } from "./app/PlatformHealthContext";
import { TeamProvider } from "./app/TeamContext";
import { ThemeProvider } from "./app/ThemeContext";
import { ToastProvider } from "./app/ToastContext";
import { UserProvider, useUser } from "./auth/UserContext";
import { Layout } from "./components/Layout";
import { NotFound } from "./components/NotFound";
import { NotificationsPage } from "./pages/NotificationsPage";
import { AboutPage } from "./pages/AboutPage";
import {
  AdminApprovalDetailPage,
  AdminApprovalsPage,
  AdminCategoriesPage,
  AdminOverviewPage,
  AdminSection,
} from "./pages/AdminSection";
import { CatalogPage } from "./pages/CatalogPage";
import { ChartDetailPage } from "./pages/ChartDetailPage";
import { ChartManagePage } from "./pages/ChartManagePage";
import { ChartVersionEditPage } from "./pages/ChartVersionEditPage";
import { ConfigPage } from "./pages/ConfigPage";
import { DocsPage } from "./pages/DocsPage";
import { OrderPage } from "./features/orders/OrderPage";
import { ProductPage } from "./pages/ProductPage";
import { RequestDetailPage } from "./features/orders/RequestDetailPage";
import { RequestsPage } from "./features/orders/RequestsPage";
import {
  KyvernoPage,
  PolicyApprovalPage,
  SecurityOverviewPage,
  SecuritySection,
} from "./pages/SecuritySection";
import { StatusPage } from "./pages/StatusPage";
import { SupportOverviewPage, SupportRequestsPage, SupportSection } from "./pages/SupportSection";
import { VersionApprovalPage } from "./pages/VersionApprovalPage";

// Graph pages; lazy so @xyflow/react is split off the main bundle.
const PoliciesMapPage = lazy(() =>
  import("./features/graph/pages/PoliciesMapPage").then((m) => ({ default: m.PoliciesMapPage })),
);
const EventMeshPage = lazy(() =>
  import("./features/graph/pages/EventMeshPage").then((m) => ({ default: m.EventMeshPage })),
);
const ResourceTopologyPage = lazy(() =>
  import("./features/graph/pages/ResourceTopologyPage").then((m) => ({
    default: m.ResourceTopologyPage,
  })),
);

// Role-aware landing: security users open their section by default; everyone
// else lands on the catalog. Rendered inside Layout, which already gates on
// auth/loading, so the user is resolved by the time this runs.
function RoleHome() {
  const { user } = useUser();
  const home =
    user?.role === "security" ? "/security" : user?.role === "support" ? "/support" : "/catalog";
  return <Navigate to={home} replace />;
}

// PlatformOnly guards the product (platform) routes. The security role lives in
// its own section and has no order/catalog access, so a direct URL bounces it
// back to /security. Other roles pass through.
function PlatformOnly() {
  const { user } = useUser();
  if (user?.role === "security") return <Navigate to="/security" replace />;
  return <Outlet />;
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <RoleHome /> },
      // About is informational and available to every role (outside PlatformOnly).
      { path: "about", element: <AboutPage /> },
      // The feed belongs to whoever is reading it, whatever section they work
      // in, so it sits beside About rather than inside PlatformOnly.
      { path: "notifications", element: <NotificationsPage /> },
      {
        path: "security",
        element: <SecuritySection />,
        children: [
          { index: true, element: <SecurityOverviewPage /> },
          { path: "policies", element: <PolicyApprovalPage /> },
          { path: "kyverno", element: <KyvernoPage /> },
        ],
      },
      // Platform-admin section: its own switcher section (like security), gated
      // to the admin role. Status lives here now; /status and /admin/publications
      // are kept as redirects so existing links/bookmarks don't break.
      {
        path: "admin",
        element: <AdminSection />,
        children: [
          { index: true, element: <AdminOverviewPage /> },
          { path: "approvals", element: <AdminApprovalsPage /> },
          { path: "approvals/:project/:name", element: <AdminApprovalDetailPage /> },
          { path: "approvals/:project/:name/:version", element: <VersionApprovalPage /> },
          { path: "categories", element: <AdminCategoriesPage /> },
          { path: "status", element: <StatusPage /> },
          { path: "config", element: <ConfigPage /> },
          { path: "publications", element: <Navigate to="/admin/approvals" replace /> },
        ],
      },
      { path: "status", element: <Navigate to="/admin/status" replace /> },
      // Support section: its own switcher section (like security/admin), gated to
      // the support role (and admins). Cross-team view of all orders.
      {
        path: "support",
        element: <SupportSection />,
        children: [
          { index: true, element: <SupportOverviewPage /> },
          { path: "requests", element: <SupportRequestsPage /> },
        ],
      },
      // Platform (product) routes: blocked for the security role.
      {
        element: <PlatformOnly />,
        children: [
          { path: "catalog", element: <CatalogPage /> },
          { path: "catalog/:project/:name", element: <ChartDetailPage /> },
          { path: "catalog/:project/:name/order", element: <OrderPage /> },
          { path: "catalog/:project/:name/manage", element: <ChartManagePage /> },
          { path: "catalog/:project/:name/manage/:version", element: <ChartVersionEditPage /> },
          { path: "requests", element: <RequestsPage /> },
          { path: "requests/:id/edit", element: <OrderPage /> },
          { path: "requests/:id/upgrade", element: <OrderPage upgrade /> },
          { path: "products/:project/:name", element: <ProductPage /> },
          { path: "requests/:id", element: <RequestDetailPage /> },
        ],
      },
      { path: "*", element: <NotFound /> },
    ],
  },
  // Docs open standalone (no portal sidebar/topbar); they have a "Портал"
  // button to return to. Kept outside the Layout route on purpose.
  { path: "/docs", element: <DocsPage /> },
  { path: "/docs/:slug", element: <DocsPage /> },
  // Full-screen graph pages, outside the portal Layout. Lazy-loaded so React
  // Flow stays out of the main bundle. Not linked from the menu yet: the
  // policies map is the editor, the other two are read-only samples of the same
  // canvas rendering another domain.
  {
    path: "/policies-map",
    element: (
      <Suspense fallback={null}>
        <PoliciesMapPage />
      </Suspense>
    ),
  },
  {
    path: "/graph/event-mesh",
    element: (
      <Suspense fallback={null}>
        <EventMeshPage />
      </Suspense>
    ),
  },
  {
    path: "/graph/topology",
    element: (
      <Suspense fallback={null}>
        <ResourceTopologyPage />
      </Suspense>
    ),
  },
]);

// Query cache: stale-while-revalidate. Every mount still revalidates
// (staleTime 0), but a cached entry renders instantly meanwhile, so moving
// between two pages that need the same data no longer flashes a spinner.
// Refetching on window focus is off - the portal's data doesn't change that
// fast, and a background refetch on every alt-tab is noise.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          {/* Platform health sits above the session: the sign-in screen has to
              know whether signing in works, and that is exactly when there is
              no session to read it from. */}
          <PlatformHealthProvider>
            <UserProvider>
              <TeamProvider>
                <CatalogProvider>
                  {/* Below the session: who is reading decides what they are
                      told, and the auditor is told nothing. */}
                  <NotificationsProvider>
                    <RouterProvider router={router} />
                  </NotificationsProvider>
                </CatalogProvider>
              </TeamProvider>
            </UserProvider>
          </PlatformHealthProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
