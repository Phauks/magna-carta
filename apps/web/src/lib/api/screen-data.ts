/*
 * One cache behind every screen read, and the two calls a screen makes against it.
 *
 * WHAT THIS FIXES. A screen used to read in an `$effect`, which means the read could not start until
 * its route chunk had been fetched, parsed and mounted — a strict waterfall, on every navigation:
 *
 *     click -> fetch route chunk -> mount -> NOW start the API read -> render
 *
 * `app.html` has set `data-sveltekit-preload-data="hover"` since the file was written, and its
 * comment says what it was for: the 200-400ms between the pointer settling on a link and the click
 * is exactly the round trip the app was paying after the click instead. That preload runs the route's
 * LOAD FUNCTION, and 93 of 98 screens had no load function that read anything — so it bought the
 * JavaScript and nothing else. Reads move into `+page.ts`, where they start in parallel with the
 * chunk AND get warmed on hover, and the screen then renders from a cache that is usually already
 * full. Nothing new is configured to get that: the preload was always there, waiting for something
 * to preload.
 *
 * WHY A CACHE AND NOT JUST AN EARLIER FETCH. A prefetch only helps if the thing it warms is the thing
 * the screen reads, which makes prefetching and caching the same mechanism. The cache is also what
 * ends the re-reads: `/api/v1/me` was being read on every navigation by the (app) layout AND again
 * on mount by 38 surfaces, and it is not a cheap call — a control-plane read, a firm Durable Object
 * wake, a permissions join, the channel and flags, the firm name and the membership state.
 *
 * WHAT A SCREEN WRITES. Two lines, and neither of them mentions a URL, a cursor or a cache key:
 *
 *     // +page.ts
 *     export const load: PageLoad = () => warm(mattersListOptions());
 *
 *     // +page.svelte
 *     const matters = createQuery(() => mattersListOptions());
 */
import {
  QueryClient,
  type FetchQueryOptions,
  type CreateInfiniteQueryOptions,
} from "@tanstack/svelte-query";

/**
 * How long an answer is served without going back to the server.
 *
 * SESSION_STABLE is for what changes when an administrator changes it — the session and its
 * permissions, the firm's own vocabularies (matter types, Locations, roles), the member roster.
 * These are page-load-scale facts, and the shared readers this replaces said so in their own words:
 * "a stale name is a worse failure than a re-read" was true of a roster read on a timer, and stays
 * true — this is a ceiling on re-reads within one visit, not a cache across sign-ins.
 *
 * RECORD is for the firm's actual data, which another member can change while you are looking at it.
 * Short enough that moving away and back re-reads, long enough that a tab switch inside one matter
 * does not.
 */
export const SESSION_STABLE = 10 * 60 * 1000;
export const RECORD = 30 * 1000;

/**
 * The app's one cache. Module-scoped, which is correct here and would not be under SSR: the app is
 * `ssr = false` on adapter-static, so there is exactly one client, one member, and no request whose
 * data could leak into another's.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: RECORD,
      // A refusal is an answer. Retrying a 403 cannot make the member permitted, retrying a 404
      // cannot make the record exist, and each attempt delays the screen saying so — which is the
      // one thing that helps. Nothing answering at all is the case worth retrying, and it is the
      // case `failure.problem === null` names.
      retry: (failureCount, error) => failureCount < 2 && !describesRefusal(error),
      // The window regaining focus is not evidence that anything changed, and a firm-wide refetch
      // storm every time somebody alt-tabs is a real cost on a Durable Object per firm.
      refetchOnWindowFocus: false,
    },
  },
});

function describesRefusal(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "failure" in error &&
    (error as { failure: { problem: unknown } }).failure.problem !== null
  );
}

/**
 * Start a screen's reads from its `+page.ts`, and DO NOT wait for them.
 *
 * NOT AWAITED, DELIBERATELY. Awaiting would hold the navigation until the data landed, so a slow
 * read would look like a frozen click — and the design system already has the honest answer to a
 * read in flight (`LoadingRegion`, docs/specs/2026-09-05-loading-region-design.md). Firing without
 * awaiting gives an instant navigation that shows the shape, and — because the same call runs on
 * hover — usually no shape at all, because the answer arrived before the click did.
 *
 * `prefetchQuery` rather than `ensureQueryData` for the same reason a load must not throw here: a
 * listing that fails is a region that settles to a failure notice with Retry, never an error page
 * over the whole screen. `prefetchQuery` resolves either way and leaves the outcome in the cache for
 * the component to render.
 */
export function warm(...reads: readonly AnyRead[]): void {
  for (const read of reads) void queryClient.prefetchQuery(read as FetchQueryOptions);
}

/**
 * Read something the app needs before any screen asks — the session, the firm's vocabularies. Same
 * call as `warm`, named for where it happens, and given the session-stable ceiling so that a screen
 * reading it a moment later gets the cache rather than a second request.
 */
export function warmSessionStable(...reads: readonly AnyRead[]): void {
  for (const read of reads) {
    void queryClient.prefetchQuery({ ...read, staleTime: SESSION_STABLE } as FetchQueryOptions);
  }
}

/*
 * A read of ANY shape, which is what warming needs and all it needs.
 *
 * The generated factories each carry their operation's exact response, error and key types, and a
 * variadic warm call mixes four unrelated ones in one argument list — `FetchQueryOptions` is
 * invariant in all of them, so no single instantiation accepts four different operations. Nothing
 * here reads a RESULT (that is the component's job, with its own types intact), so what warming
 * needs of a read is only that it is one: a key to file the answer under, and a function to get it.
 *
 * The two assertions above are the price, and they are why this type is here rather than at the ~98
 * call sites that would otherwise each carry one. `prefetchQuery` never returns a value and never
 * rejects, so nothing downstream can be misled by the widening.
 */
interface AnyRead {
  readonly queryKey: readonly unknown[];
  readonly queryFn?: unknown;
}

/**
 * One page of a cursor-paged listing, as every listing on the contract answers it. `nextCursor` is a
 * string while the record continues and null when it does not — never absent, so "there is no more"
 * and "nobody said" cannot be confused. The value is opaque: pass it back, never parse it.
 */
interface CursorPage {
  readonly nextCursor?: string | null;
}

/**
 * Teach a generated infinite listing where its next page is.
 *
 * The generator emits the `queryFn` and the key for every paged operation but cannot emit this: the
 * cursor field is a convention of OUR contract, not something OpenAPI states, so the one place that
 * convention is written down in the app is here rather than in each of the ~55 paged screens. A
 * listing whose last page answered a null cursor has no next page, which is what stops the reader's
 * scroll asking for one.
 */
export function paged<
  TPage extends CursorPage,
  TError,
  TData,
  TKey extends readonly unknown[],
  TPageParam,
>(
  options: CreateInfiniteQueryOptions<TPage, TError, TData, TKey, TPageParam>,
): CreateInfiniteQueryOptions<TPage, TError, TData, TKey, TPageParam> {
  return {
    ...options,
    // The generated page parameter is the cursor, or a whole request for a page — never "no page
    // yet", so the first page is asserted. The generated queryFn reads an undefined parameter as a
    // request with no cursor (svelte-query.gen.ts), which is exactly what the first page is.
    initialPageParam: undefined as TPageParam,
    getNextPageParam: (last: TPage) => (last.nextCursor ?? undefined) as TPageParam | undefined,
  };
}

/**
 * Warm a paged listing's FIRST page from a `+page.ts`. Only the first: the pages after it are what
 * the reader asks for by scrolling, and reading ahead on a hover would spend a firm's request budget
 * on rows nobody has looked at.
 *
 * Widened the same way `warm` is, for the same reason: `prefetchInfiniteQuery`'s parameter is
 * invariant in the operation's own types, so the generated options for one listing are not
 * assignable to it without the widening, and nothing downstream reads a result.
 */
export function warmPaged(...reads: readonly AnyRead[]): void {
  for (const read of reads) {
    void queryClient.prefetchInfiniteQuery(
      read as Parameters<QueryClient["prefetchInfiniteQuery"]>[0],
    );
  }
}
