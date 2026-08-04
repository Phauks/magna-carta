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
}

export interface SearchIndexMessage {
  readonly firmId: string;
  readonly matterId: string;
  readonly documentId: string;
  readonly version: number;
  // The R2 key of the committed version's bytes — what the extract stage reads. Pinned into the message
  // at enqueue time so the job indexes the exact version that triggered it, even if the file has since
  // gained a newer current version (which enqueues its own job).
  readonly sourceKey: string;
  readonly contentType: string | null;
}

export interface SearchIndexCoordinator {
  start(message: SearchIndexMessage): Promise<SearchIndexJobState>;
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
