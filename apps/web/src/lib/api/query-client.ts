/*
 * The app's TanStack QueryClient — the one cache every typed call shares.
 *
 * Defaults chosen for a legal record rather than a feed: a short staleness window (the file list is
 * read far more often than it changes, and a refetch on focus is what makes a second tab agree with
 * the first), and NO retry on a 4xx. Retrying a 401 or a 404 cannot succeed and only delays the
 * honest answer — the session guard wants to see the 401 immediately, not three seconds later.
 */
import { QueryClient } from "@tanstack/svelte-query";

/** A 4xx is a verdict, not a blip; only a transport/5xx failure is worth a second attempt. */
function isClientError(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  return typeof status === "number" && status >= 400 && status < 500;
}

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => !isClientError(error) && failureCount < 2,
      },
    },
  });
}
