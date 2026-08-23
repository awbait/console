import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ComponentType, lazy, type ReactNode, StrictMode, Suspense } from "react";
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
import { OrderPage } from "./features/orders/OrderPage";
import { RequestDetailPage } from "./features/orders/RequestDetailPage";
import { RequestsPage } from "./features/orders/RequestsPage";
import { CatalogPage } from "./pages/CatalogPage";
import { ChartDetailPage } from "./pages/ChartDetailPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { ProductPage } from "./pages/ProductPage";

// page loads a screen only when somebody opens it. Everything the portal keeps
// in the first bundle is paid for by every person on every visit, and most of
// what follows is opened by a few of them: the admin, the security and the
// support sections, the documentation, the version constructor.
//
// Our pages are named exports, and lazy() wants a module with a default one, so
// the name is passed along and picked out here.
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(() => load().then((m) => ({ default: m[name] })));
}

// The catalog, an order and a product stay in the first bundle: that is the
// path everybody walks, and a screen split off it would be a wait bought for
// nothing.
const AboutPage = page(() => import("./pages/AboutPage"), "AboutPage");
const AdminSection = page(() => import("./pages/AdminSection"), "AdminSection");
const AdminOverviewPage = page(() => import("./pages/AdminSection"), "AdminOverviewPage");
const AdminApprovalsPage = page(() => import("./pages/AdminSection"), "AdminApprovalsPage");
const AdminApprovalDetailPage = page(
  () => import("./pages/AdminSection"),
  "AdminApprovalDetailPage",
);
const AdminCategoriesPage = page(() => import("./pages/AdminSection"), "AdminCategoriesPage");
const AdminActivityPage = page(() => import("./pages/AdminActivityPage"), "AdminActivityPage");
const ChartManagePage = page(() => import("./pages/ChartManagePage"), "ChartManagePage");
const ChartVersionEditPage = page(
  () => import("./pages/ChartVersionEditPage"),
  "ChartVersionEditPage",
);
const ConfigPage = page(() => import("./pages/ConfigPage"), "ConfigPage");
const DocsPage = page(() => import("./pages/DocsPage"), "DocsPage");
const KyvernoPage = page(() => import("./pages/SecuritySection"), "KyvernoPage");
const PolicyApprovalPage = page(() => import("./pages/SecuritySection"), "PolicyApprovalPage");
const SecurityOverviewPage = page(() => import("./pages/SecuritySection"), "SecurityOverviewPage");
const SecuritySection = page(() => import("./pages/SecuritySection"), "SecuritySection");
const StatusPage = page(() => import("./pages/StatusPage"), "StatusPage");
const SupportOverviewPage = page(() => import("./pages/SupportSection"), "SupportOverviewPage");
const SupportRequestsPage = page(() => import("./pages/SupportSection"), "SupportRequestsPage");
const SupportSection = page(() => import("./pages/SupportSection"), "SupportSection");
const VersionApprovalPage = page(() => import("./pages/VersionApprovalPage"), "VersionApprovalPage");

// Graph pages; lazy so @xyflow/react is split off the main bundle.
const PoliciesMapPage = page(
  () => import("./features/graph/pages/PoliciesMapPage"),
  "PoliciesMapPage",
);
const EventMeshPage = page(() => import("./features/graph/pages/EventMeshPage"), "EventMeshPage");
const ResourceTopologyPage = page(
  () => import("./features/graph/pages/ResourceTopologyPage"),
  "ResourceTopologyPage",
);

// Standalone wraps the routes drawn outside the portal shell (the docs, the
// full-screen graphs). Inside the shell the wait is held by Layout, around the
// place the page appears; out here there is no shell to hold it, and these
// pages take over the whole window anyway.
function Standalone({ page }: { page: ReactNode }) {
  return <Suspense fallback={null}>{page}</Suspense>;
}

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
          { path: "activity", element: <AdminActivityPage /> },
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
  { path: "/docs", element: <Standalone page={<DocsPage />} /> },
  { path: "/docs/:slug", element: <Standalone page={<DocsPage />} /> },
  // Full-screen graph pages, outside the portal Layout. Lazy-loaded so React
  // Flow stays out of the main bundle. Not linked from the menu yet: the
  // policies map is the editor, the other two are read-only samples of the same
  // canvas rendering another domain.
  { path: "/policies-map", element: <Standalone page={<PoliciesMapPage />} /> },
  { path: "/graph/event-mesh", element: <Standalone page={<EventMeshPage />} /> },
  { path: "/graph/topology", element: <Standalone page={<ResourceTopologyPage />} /> },
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
