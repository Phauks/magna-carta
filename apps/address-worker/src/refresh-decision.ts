// THE REFRESH DECISION — whether today's cron starts a build.
//
// OpenAddresses republishes sources continuously, and the index is built from a snapshot of them, so it
// goes stale; a month is the cadence the index is meant to be rebuilt at. The cron runs daily, so a
// build that fails is retried the next day rather than the next month, while the old index keeps
// answering — a failed build never moves the pointer.
//
// Two reads, in the cheap order. The pointer is one small R2 read, and on almost every day it says the
// index is fresh and the check ends there. Only a stale or missing index asks the build container
// whether it is already building, because asking wakes a standard-4 instance, and waking it every day
// to hear "idle" would bill a container start for an answer the pointer already gave.

import { ADDRESS_BUILD_INSTANCE_NAME, type AddressContainerFetcher } from "./forward-query.ts";

// The pointer's key: the build that answers queries, and when it was built.
export const ADDRESS_POINTER_KEY = "us/current.json";

// How old an index may be before the cron replaces it.
export const ADDRESS_INDEX_MAXIMUM_AGE_MILLISECONDS = 30 * 24 * 60 * 60 * 1000;

// The build container's own account of itself (GET /builds).
export type BuildState = "idle" | "running" | "failed";

export type IndexAge = "fresh" | "stale";

export type RefreshDecision =
  // The index is younger than the maximum age: nothing to do.
  | "fresh"
  // Stale or missing, and a build is already running: let it finish.
  | "running"
  // Stale or missing, and nothing is building (idle, or the last attempt failed): start one.
  | "start";

// How old the published index is, from the pointer's text. A missing pointer, one that does not parse,
// or one whose builtAt is not a time, all read as stale: each means queries are answered from nothing
// or from something this check cannot vouch for, and a rebuild is the repair for all three.
export function indexAgeOf(pointerText: string | null, now: number): IndexAge {
  if (pointerText === null) return "stale";
  let builtAt: unknown;
  try {
    builtAt = (JSON.parse(pointerText) as { builtAt?: unknown }).builtAt;
  } catch {
    return "stale";
  }
  if (typeof builtAt !== "string") return "stale";
  const builtAtMilliseconds = Date.parse(builtAt);
  if (Number.isNaN(builtAtMilliseconds)) return "stale";
  return now - builtAtMilliseconds > ADDRESS_INDEX_MAXIMUM_AGE_MILLISECONDS ? "stale" : "fresh";
}

// The decision itself. `buildState` is only consulted for a stale index — the caller does not ask the
// build container at all when the pointer is fresh — and a failed build is treated like an idle one:
// the failure is already on record in the container's log, and the old index is still answering, so
// the repair is simply to try again.
export function decideRefresh(input: {
  readonly indexAge: IndexAge;
  readonly buildState: BuildState;
}): RefreshDecision {
  if (input.indexAge === "fresh") return "fresh";
  if (input.buildState === "running") return "running";
  return "start";
}

export interface RefreshDependencies {
  // The pointer's text, or null when there is none.
  readonly readPointer: () => Promise<string | null>;
  readonly buildContainer: AddressContainerFetcher;
  readonly now: number;
}

// Run the daily check. A build container that answers anything unexpected throws, which is how a cron
// failure reaches the worker's logs rather than passing silently; the index itself is untouched by any
// failure here.
export async function refreshAddressIndex(
  dependencies: RefreshDependencies,
): Promise<RefreshDecision> {
  const indexAge = indexAgeOf(await dependencies.readPointer(), dependencies.now);
  if (indexAge === "fresh") return "fresh";

  const buildState = await readBuildState(dependencies.buildContainer);
  const decision = decideRefresh({ indexAge, buildState });
  if (decision === "start") await startBuild(dependencies.buildContainer);
  return decision;
}

async function readBuildState(container: AddressContainerFetcher): Promise<BuildState> {
  const response = await container.fetch(
    new Request(`http://${ADDRESS_BUILD_INSTANCE_NAME}/builds`),
  );
  if (!response.ok) {
    throw new Error(`address build state answered status ${String(response.status)}`);
  }
  const { state } = await response.json<{ state?: unknown }>();
  if (state === "idle" || state === "running" || state === "failed") return state;
  throw new Error("address build state was not one the refresh check knows");
}

async function startBuild(container: AddressContainerFetcher): Promise<void> {
  const response = await container.fetch(
    new Request(`http://${ADDRESS_BUILD_INSTANCE_NAME}/builds`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ country: "US" }),
    }),
  );
  await response.body?.cancel();
  // 202 started it; 409 means one began between the state read and this call, which is the outcome
  // this check wanted anyway.
  if (response.status === 202 || response.status === 409) return;
  throw new Error(`address build start answered status ${String(response.status)}`);
}
