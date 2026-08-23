// The state one compaction pass persists, the queue message the consumer reads, and the Durable Object
// RPC surface both sides call. One home so the trigger, the coordinator, and the consumer cannot drift on
// field names — the shape index-types.ts already establishes for the write pipeline.

// A pass ends in exactly one of these. `deferred` is the same distinction the write pipeline draws and it
// is not a failure: a compaction whose engine is not deployed is background housekeeping the platform
// owes and has not lost, and retrying it against an unbuilt engine would only burn the message's attempts
// until it dead-lettered. `skipped` is the pass that ran and correctly did nothing — a corpus that fell
// back under the threshold before its message was consumed, which a burst of ingests produces routinely.
export type SearchCompactionStatus =
  | "queued"
  | "running"
  | "compacted"
  | "skipped"
  | "deferred"
  | "failed";

export interface SearchCompactionState {
  readonly status: SearchCompactionStatus;
  // The R2 key of the split the last successful pass published; null otherwise.
  readonly objectKey: string | null;
  // How many source splits that pass merged, so a caller can see convergence without reading the catalog.
  readonly mergedSplits: number;
  readonly reason: string | null;
  readonly startedAt: string | null;
}

export interface SearchCompactionMessage {
  readonly firmId: string;
  // The matter the corpus belongs to: provenance, and the dimension the merged split object is stamped
  // with. A review-set corpus carries its review set's matter.
  readonly matterId: string;
  // The corpus to compact. ABSENT means the matter's own corpus, which is what every message enqueued
  // before review sets took an index scope of their own means — so a message in flight across a deploy
  // still compacts what it was sent to compact.
  readonly corpusKind?: "matter" | "reviewSet";
  readonly corpusId?: string;
}

// The corpus a message names, with the pre-widening default in ONE place.
export function compactionMessageCorpus(message: SearchCompactionMessage): {
  readonly kind: "matter" | "reviewSet";
  readonly id: string;
} {
  return { kind: message.corpusKind ?? "matter", id: message.corpusId ?? message.matterId };
}

export interface SearchCompactionStartOutcome {
  readonly state: SearchCompactionState;
  /**
   * True only when this call put a message on the queue. False when a pass for this corpus is already in
   * flight — which is the whole point of the coordinator: a thousand ingests crossing the threshold in
   * one burst must produce one compaction, not a thousand.
   */
  readonly started: boolean;
}

export interface SearchCompactionCoordinator {
  start(message: SearchCompactionMessage): Promise<SearchCompactionStartOutcome>;
  markRunning(): Promise<void>;
  markCompacted(objectKey: string, mergedSplits: number): Promise<void>;
  markSkipped(reason: string): Promise<void>;
  markDeferred(reason: string): Promise<void>;
  markFailed(reason: string): Promise<void>;
  status(): Promise<SearchCompactionState>;
}

// The coordinator's Durable Object name. Keyed by the CORPUS, not by a pass: two passes over one corpus
// are never independent work — the second would select splits the first is about to supersede, merge them
// twice, and leave one of the two merged splits orphaned in the firm's bucket. Keying by corpus is what
// makes "one compaction at a time here" structural rather than a convention.
export function searchCompactionJobName(firmId: string, corpusId: string): string {
  return `${firmId}:${corpusId}`;
}
