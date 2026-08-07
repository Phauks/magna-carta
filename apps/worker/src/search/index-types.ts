// The state one index job persists, the queue message the consumer reads, and the Durable Object RPC
// surface both sides call. One home so the enqueue path, the coordinator, and the consumer cannot drift
// on field names (the conversion-types.ts precedent).

// `deferred` is the state that makes this pipeline safe to run before the engines are deployed, and it
// is NOT a failure. An extraction or index engine that is not yet reachable reports so as a typed
// outcome; the job records `deferred` and the message is acked, because retrying against an unbuilt
// engine would only burn attempts until the message dead-lettered and the document quietly fell out of
// the corpus. A deferred job is a standing record of work owed: deploying the engine and replaying the
// enqueue drains it, and because the split id is derived from documentId + version, the replay produces
// the same split rather than a duplicate.
export type SearchIndexJobStatus = "queued" | "running" | "indexed" | "deferred" | "failed";

export interface SearchIndexJobState {
  readonly status: SearchIndexJobStatus;
  // The R2 key of the published split, set when indexed.
  readonly objectKey: string | null;
  // Why the job is deferred or failed; null otherwise.
  readonly reason: string | null;
  // How many times this version has been started against the CURRENT engine generation. A document
  // nothing can read is a permanent candidate for the repair sweep — the catalog has no way to know it
  // was already tried — so without a bound it would be re-extracted every pass forever. Counted here
  // rather than in the catalog because the job's Durable Object already owns the outcome, and because
  // recording it in the catalog would cost a per-firm schema change for a fact that is only ever read
  // by the thing that wrote it.
  readonly attempts: number;
  // Which engines were bound when those attempts were spent. A deploy that binds an engine that was
  // missing makes every previous refusal stale — the document was never really tried against THIS
  // pipeline — so the count resets rather than holding a backlog down permanently.
  readonly engineGeneration: string;
}

// How many times one version is re-attempted against an unchanged set of engines before the sweep stops
// paying for it. Three is enough to ride out a transient failure that the queue's own retries did not
// absorb, and small enough that a firm's permanently-unreadable documents stop costing anything within a
// few passes. A newly bound engine resets the count, so this never strands work the platform could now do.
export const SEARCH_INDEX_MAXIMUM_ATTEMPTS_PER_GENERATION = 3;

export interface SearchIndexMessage {
  readonly firmId: string;
  // The matter the committed version belongs to — a fact about the document, not a choice of index. The
  // consumer turns it into the corpus it indexes into (index-consumer.ts). Kept as a matter here rather
  // than pre-resolved into a corpus so a message enqueued before a deploy is still readable after one;
  // an entry point that feeds a different corpus carries its own scope on its own message.
  readonly matterId: string;
  readonly documentId: string;
  readonly version: number;
  // The R2 key of the committed version's bytes — what the extract stage reads. Pinned into the message
  // at enqueue time so the job indexes the exact version that triggered it, even if the file has since
  // gained a newer current version (which enqueues its own job).
  readonly sourceKey: string;
  readonly contentType: string | null;
  // Which extraction/index engines were bound when this message was made. Carried on the message so the
  // coordinator can tell "this document has already been tried against exactly this pipeline" from
  // "the pipeline has changed since it was tried", which is the difference between a wasted re-attempt
  // and a backlog draining after a deploy.
  readonly engineGeneration: string;
}

// What `start` did, as distinct from what the job now holds. A caller that wants to count the work it
// caused — the repair sweep, which reports "enqueued" — cannot read that off the state alone: a job
// already `queued` from an earlier pass and a job queued by THIS call look identical afterwards.
export interface SearchIndexStartOutcome {
  readonly state: SearchIndexJobState;
  /**
   * True only when this call put a message on the queue. False when the job was already indexed,
   * already in flight, or has spent its attempts against the current engine generation.
   */
  readonly started: boolean;
}

export interface SearchIndexCoordinator {
  start(message: SearchIndexMessage): Promise<SearchIndexStartOutcome>;
  markRunning(): Promise<void>;
  markIndexed(objectKey: string): Promise<void>;
  markDeferred(reason: string): Promise<void>;
  markFailed(reason: string): Promise<void>;
  status(): Promise<SearchIndexJobState>;
}

// The job's Durable Object name. Keyed by the document VERSION, not the document: two versions of the
// same file are two independent units of work that can be in flight at once, and keying by version is
// what lets a redelivery of one of them find its own job rather than trample the other's state.
export function searchIndexJobName(firmId: string, documentId: string, version: number): string {
  return `${firmId}:${documentId}:${version}`;
}
