import { type QueryKey, useQuery } from "@tanstack/react-query";
import { useId } from "react";

interface AsyncState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

// useAsync runs an async fn on mount and whenever deps change. The fn receives an
// AbortSignal that is aborted on unmount or before the next run; forward it to
// fetch (see api client) to actually cancel in-flight requests when deps change
// quickly. A `() => Promise<T>` fn that ignores the signal is still accepted.
//
// Pass a key (see api/queryKeys.ts) when two places load the same thing: they
// then share one cache entry, so the second one renders from cache immediately
// and revalidates in the background instead of blanking out to a spinner.
// Without a key the call gets a private entry per hook instance - same behaviour
// as before, no sharing.
// `refetchInterval` (ms) keeps a value fresh on its own, for the few things that
// change without the user doing anything (platform health). Prefer it to a
// setInterval around `reload`: the query layer pauses it while the tab is in the
// background and resumes on return, and it cannot be left running by a stale
// closure.
export function useAsync<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
  key?: QueryKey,
  opts?: { refetchInterval?: number },
): AsyncState<T> {
  const instanceId = useId();
  const query = useQuery({
    queryKey: key ?? ["useAsync", instanceId, ...deps],
    queryFn: ({ signal }) => fn(signal),
    refetchInterval: opts?.refetchInterval,
  });

  return {
    data: query.data ?? null,
    error: (query.error as Error | null) ?? null,
    // Only the first load (no data to show yet) counts as loading: a background
    // revalidation must not swap a rendered page back to a spinner.
    loading: query.isPending,
    reload: () => {
      void query.refetch();
    },
  };
}
