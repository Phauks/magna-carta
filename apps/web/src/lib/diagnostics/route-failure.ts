/*
 * A routing failure, in the same shape as every other failure in the app.
 *
 * `+error.svelte` is handed a status and an error rather than an outcome, because the failure
 * happened while SvelteKit was loading or rendering rather than inside a call. Turning it into the
 * same record means the crash screen renders through the same component, states the same facts and
 * copies the same trace as a failed panel — which is the whole point of there being one failure
 * surface rather than a special case for the worst case.
 */
import type { Failure, Problem } from "$lib/api/problem.ts";

/** What `+error.svelte` reads off `$app/state`'s page. Narrowed so this stays testable. */
export interface RoutePageState {
  readonly status: number;
  readonly error: App.Error | null;
  readonly url: { readonly pathname: string; readonly search: string };
}

/**
 * Build the failure record for a route-level error.
 *
 * The request line names the ROUTE rather than an API call, because that is what actually failed:
 * nothing here knows which call was in flight, and inventing one would put a wrong fact in a block
 * built to be pasted into a report. `failedAt` is now — the boundary has no earlier moment to offer,
 * and saying so honestly beats leaving the field out.
 */
export function routeFailure(page: RoutePageState): Failure {
  const problem: Problem = {
    status: page.status,
    detail: page.error?.message,
    errorId: page.error?.errorId,
  };
  return {
    problem,
    request: `PAGE ${page.url.pathname}`,
    failedAt: new Date(),
    ...(page.error?.cause === undefined ? {} : { cause: page.error.cause }),
  };
}
