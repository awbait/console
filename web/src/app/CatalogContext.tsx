import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useEffect } from "react";
import { api } from "../api/client";
import { qk } from "../api/queryKeys";
import type { CatalogChart, Category } from "../api/types";
import { useUser } from "../auth/UserContext";

// How long a catalog snapshot counts as fresh before navigation or returning
// focus revalidates it in the background. Short enough that a chart version
// published in another tab shows up on the next visit to an order, long enough
// that rapid clicks between pages do not hit Harbor on every transition.
export const CATALOG_STALE_MS = 15_000;

// Background refresh while the tab is visible, so an order page left open
// notices newly published chart versions on its own. React Query pauses the
// interval automatically while the tab is hidden.
export const CATALOG_REFRESH_MS = 2 * 60 * 1000;

export function catalogQueryOptions(signedIn: boolean) {
  return {
    queryKey: qk.catalog(),
    queryFn: ({ signal }: { signal: AbortSignal }) => api.getCatalog(signal),
    staleTime: CATALOG_STALE_MS,
    refetchOnWindowFocus: signedIn,
    refetchInterval: signedIn ? CATALOG_REFRESH_MS : false,
  } as const;
}

// Revalidate the catalog in the background only when it is already stale,
// without cancelling a fetch that is already in flight.
export function refetchStaleCatalog(queryClient: QueryClient): Promise<void> {
  return queryClient.refetchQueries(
    { queryKey: qk.catalog(), stale: true },
    { cancelRefetch: false },
  );
}

// Whether an upgrade page should force-reload the catalog once before calling
// a target version unavailable: the version may have just been published while
// this tab held an older catalog snapshot.
export function shouldRecheckUpgrade(params: {
  upgrade: boolean;
  ready: boolean;
  targetVersion: string;
  catalogLoading: boolean;
  allowedUpgrades: string[];
  recheckedKey: string | null;
  checkKey: string;
}): boolean {
  return (
    params.upgrade &&
    params.ready &&
    !!params.targetVersion &&
    !params.catalogLoading &&
    !params.allowedUpgrades.includes(params.targetVersion) &&
    params.recheckedKey !== params.checkKey
  );
}

// The catalog (categories + charts with a publication overlay) is shared via
// context: it drives the left menu, the catalog page, upgrade availability on
// orders, and the "Category" column in order lists.
interface CatalogState {
  categories: Category[];
  charts: CatalogChart[];
  loading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
  refresh: () => void;
}

const CatalogCtx = createContext<CatalogState>({
  categories: [],
  charts: [],
  loading: true,
  error: null,
  reload: async () => {},
  refresh: () => {},
});

export function CatalogProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const signedIn = !!user;
  const queryClient = useQueryClient();
  const query = useQuery(catalogQueryOptions(signedIn));

  const reload = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: qk.catalog() });
  }, [queryClient]);

  const refresh = useCallback(() => {
    if (!signedIn) return;
    void refetchStaleCatalog(queryClient);
  }, [queryClient, signedIn]);

  // React Query's refetchOnWindowFocus covers tab switches (visibilitychange);
  // listening to window focus also covers moving between side-by-side windows.
  useEffect(() => {
    if (!signedIn) return;
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [signedIn, refresh]);

  return (
    <CatalogCtx.Provider
      value={{
        categories: query.data?.categories ?? [],
        charts: query.data?.charts ?? [],
        loading: query.isPending,
        error: (query.error as Error | null) ?? null,
        reload,
        refresh,
      }}
    >
      {children}
    </CatalogCtx.Provider>
  );
}

export function useCatalog() {
  return useContext(CatalogCtx);
}

// useRefreshCatalog asks the catalog to revalidate in the background when a
// screen that depends on available versions opens (or switches its target).
// Within CATALOG_STALE_MS it is a no-op, and it never blanks the screen.
export function useRefreshCatalog(dep?: unknown) {
  const { refresh } = useCatalog();
  // biome-ignore lint/correctness/useExhaustiveDependencies: dep is an explicit re-trigger key (e.g. route param)
  useEffect(() => {
    refresh();
  }, [refresh, dep]);
}

// Catalog chart by coordinates (project/name).
export function findCatalogChart(
  charts: CatalogChart[],
  project: string,
  name: string,
): CatalogChart | undefined {
  return charts.find((c) => c.project === project && c.name === name);
}

// A chart appears in the left menu when its publication is approved and the
// view document contains an order form (views.order).
export function inMenu(c: CatalogChart): boolean {
  return !!c.publication?.published && !!c.publication?.has_order_view;
}

// Friendly chart label for menu/headers: "ingress-gateway" -> "Ingress
// Gateway". A permanent human name will come from the publication later; for
// now - deterministic cosmetics.
export function chartLabel(name: string): string {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
