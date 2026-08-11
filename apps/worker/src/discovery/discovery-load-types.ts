// The state one load's coordinator persists, the plan it works through, and the RPC surface the route
// and the consumer both call. One home so the declaration path, the coordinator, and the eventual
// processing consumer cannot drift on a field name (the index-types.ts precedent).

// A load fans out in CHUNKS, from a coordinator, against the backlog — never from a request handler.
// A quarter-million messages enqueued from an HTTP request is not a fan-out, it is a timeout.
export type DiscoveryLoadJobStatus =
  | "declared"
  | "allocating"
  | "allocated"
  // Not a failure: work owed and not lost. A coordinator parks here when the material it was told to
  // expect has not arrived yet, and leaves it by being started again.
  | "waiting"
  | "failed";

export interface DiscoveryLoadJobState {
  readonly status: DiscoveryLoadJobStatus;
  // How far through the plan the coordinator has committed. THE CURSOR LIVES IN DURABLE STORAGE AND
  // NEVER IN MEMORY: eviction, deploy, and hibernation are all lossless because the next turn reads
  // this back rather than remembering it. A resumed turn re-plans from here, and the row inserts are
  // idempotent, so a turn that committed and then died before checkpointing redoes itself without
  // duplicating anything.
  readonly cursor: number;
  // How many items the plan holds in total. Zero until the first turn has planned.
  readonly plannedCount: number;
  // How many review documents have actually committed.
  readonly allocatedCount: number;
  // Why the job is waiting or failed; null otherwise. A stable sentence, never file content.
  readonly reason: string | null;
}

export const UNKNOWN_LOAD_JOB: DiscoveryLoadJobState = {
  status: "failed",
  cursor: 0,
  plannedCount: 0,
  allocatedCount: 0,
  reason: "unknown load",
};

// What the coordinator is asked to fan out. Identifiers only — never bytes, never text, never a
// selection large enough to be content. The selection is resolved from the database on each turn
// rather than carried, so a turn after a deploy resolves against the schema it is running under.
export interface DiscoveryLoadPlanMessage {
  readonly firmId: string;
  readonly reviewSetId: string;
  readonly loadId: string;
  readonly matterId: string;
  readonly lane: string;
  readonly recordCustodianId: string;
  // The things to load, by handle. Bounded by the selection ceiling, which is what keeps this
  // message inside the queue's per-message size wall by construction rather than by hope.
  readonly fileIds: readonly string[];
  readonly emailMessageIds: readonly string[];
}

export interface DiscoveryLoadCoordinatorRpc {
  start(message: DiscoveryLoadPlanMessage): Promise<DiscoveryLoadJobState>;
  checkpoint(progress: { cursor: number; allocatedCount: number }): Promise<void>;
  markAllocated(allocatedCount: number): Promise<void>;
  markWaiting(reason: string): Promise<void>;
  markFailed(reason: string): Promise<void>;
  status(): Promise<DiscoveryLoadJobState>;
}

// The coordinator's Durable Object name. Keyed by the LOAD, not the review set: two loads into one
// review set are two independent units of work that can be in flight at once, and keying by the load
// is what lets a redelivery of one find its own cursor rather than trample the other's.
export function discoveryLoadJobName(firmId: string, loadId: string): string {
  return `${firmId}:${loadId}`;
}
