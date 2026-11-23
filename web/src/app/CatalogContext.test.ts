import { describe, expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { qk } from "../api/queryKeys";
import {
  CATALOG_REFRESH_MS,
  CATALOG_STALE_MS,
  catalogQueryOptions,
  refetchStaleCatalog,
  shouldRecheckUpgrade,
} from "./CatalogContext";

// Mirrors CatalogProvider's mounted useQuery observer so refetchQueries sees an
// active subscription with the exact staleTime under test.
function mountCatalogObserver<T>(
  qc: QueryClient,
  queryFn: (ctx: { signal: AbortSignal }) => Promise<T>,
  staleTime: number,
) {
  const observer = new QueryObserver<T>(qc, {
    queryKey: qk.catalog(),
    queryFn,
    staleTime,
  });
  return observer.subscribe(() => {});
}

describe("catalogQueryOptions", () => {
  test("enables focus and periodic refresh when signed in", () => {
    const opts = catalogQueryOptions(true);
    expect(opts.queryKey).toEqual(qk.catalog());
    expect(opts.staleTime).toBe(CATALOG_STALE_MS);
    expect(opts.refetchOnWindowFocus).toBe(true);
    expect(opts.refetchInterval).toBe(CATALOG_REFRESH_MS);
  });

  test("disables background polling when unauthenticated", () => {
    const opts = catalogQueryOptions(false);
    expect(opts.refetchOnWindowFocus).toBe(false);
    expect(opts.refetchInterval).toBe(false);
  });
});

describe("refetchStaleCatalog", () => {
  test("skips refetch while catalog data is still fresh", async () => {
    const qc = new QueryClient();
    let calls = 0;
    const fetchCatalog = async () => {
      calls++;
      return { categories: [], charts: [{ versions: [`1.0.${calls}`] }] };
    };

    const unsub = mountCatalogObserver(qc, fetchCatalog, CATALOG_STALE_MS);
    await qc.fetchQuery({ queryKey: qk.catalog(), queryFn: fetchCatalog, staleTime: CATALOG_STALE_MS });
    expect(calls).toBe(1);

    // Within staleTime, passive revalidation is a no-op even on an active observer.
    await refetchStaleCatalog(qc);
    expect(calls).toBe(1);
    unsub();
    qc.clear();
  });

  test("refetches once catalog data is stale and picks up newly published versions", async () => {
    const qc = new QueryClient();
    let calls = 0;
    const fetchCatalog = async () => {
      calls++;
      return { categories: [], charts: [{ versions: calls === 1 ? ["1.0.0"] : ["1.1.0", "1.0.0"] }] };
    };

    // Active observer with staleTime: 0 so the fetched entry is immediately stale.
    const unsub = mountCatalogObserver(qc, fetchCatalog, 0);
    await qc.fetchQuery({ queryKey: qk.catalog(), queryFn: fetchCatalog, staleTime: 0 });
    expect(calls).toBe(1);

    await refetchStaleCatalog(qc);
    expect(calls).toBe(2);
    const data = qc.getQueryData<{ charts: { versions: string[] }[] }>(qk.catalog());
    expect(data?.charts[0].versions).toEqual(["1.1.0", "1.0.0"]);
    unsub();
    qc.clear();
  });

  test("does not cancel an already in-flight catalog request", async () => {
    const qc = new QueryClient();
    let calls = 0;
    let aborted = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const fetchCatalog = async ({ signal }: { signal: AbortSignal }) => {
      calls++;
      signal.addEventListener("abort", () => {
        aborted = true;
      });
      await gate;
      return { categories: [], charts: [] };
    };

    const unsub = mountCatalogObserver(qc, fetchCatalog, 0);
    const passive = refetchStaleCatalog(qc);
    release();
    await passive;

    expect(calls).toBe(1);
    expect(aborted).toBe(false);
    unsub();
    qc.clear();
  });
});

describe("shouldRecheckUpgrade", () => {
  const base = {
    upgrade: true,
    ready: true,
    targetVersion: "1.2.0",
    catalogLoading: false,
    allowedUpgrades: ["1.1.0"],
    recheckedKey: null as string | null,
    checkKey: "ord-1:1.0.0:1.2.0",
  };

  test("rechecks once when target version is missing from cached catalog", () => {
    expect(shouldRecheckUpgrade(base)).toBe(true);
  });

  test("does not recheck once target version is already allowed", () => {
    expect(shouldRecheckUpgrade({ ...base, allowedUpgrades: ["1.2.0", "1.1.0"] })).toBe(false);
  });

  test("does not loop after recheck already completed for the same key", () => {
    expect(shouldRecheckUpgrade({ ...base, recheckedKey: base.checkKey })).toBe(false);
  });

  test("rechecks again when target version or order changes", () => {
    expect(shouldRecheckUpgrade({ ...base, recheckedKey: "ord-1:1.0.0:1.1.5" })).toBe(true);
  });

  test("waits until order and chart are ready and initial catalog has loaded", () => {
    expect(shouldRecheckUpgrade({ ...base, ready: false })).toBe(false);
    expect(shouldRecheckUpgrade({ ...base, catalogLoading: true })).toBe(false);
    expect(shouldRecheckUpgrade({ ...base, upgrade: false })).toBe(false);
    expect(shouldRecheckUpgrade({ ...base, targetVersion: "" })).toBe(false);
  });
});
