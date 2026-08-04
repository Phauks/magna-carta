// The job state the coordinator Durable Object persists, the queue message the consumer reads, and the
// Durable Object RPC surface the routes and the consumer both call. One home so they never drift on
// field names (the conversion and bundle job types set the precedent).

export type DocumentAssemblyJobStatus = "queued" | "running" | "done" | "failed";

export interface DocumentAssemblyJobState {
  readonly status: DocumentAssemblyJobStatus;
  readonly fileId: string | null; // set when done — the filed document
  readonly fileVersionId: string | null; // set when done — the version the assembly produced
  readonly reason: string | null; // an error code from a closed set, when failed
}

// THE MESSAGE CARRIES IDENTIFIERS ONLY. No merge value ever rides a queue: the resolved context exists
// in memory for the life of the job and is never persisted, logged, or enqueued, which is what keeps a
// client's identifying details out of a dead-letter store. The consumer resolves everything it needs
// from the identifiers here, through the firm-scoped data-access layer.
export interface DocumentAssemblyMessage {
  readonly firmId: string;
  // The firm's recorded R2 bucket, resolved by the submitting route through files/firm-bucket.ts and
  // carried so the consumer reads the template bytes from, and writes the output to, the SAME seam the
  // route resolved. Re-deriving it in the consumer would let a firm re-provisioned mid-flight read a
  // template from a different bucket than the one it was stored in (the conversion job's precedent).
  readonly bucketName: string;
  readonly assemblyId: string;
  readonly matterId: string;
  readonly templateVersionId: string;
  readonly folderId: string | null;
  readonly requestedBy: string | null;
}

export interface DocumentAssemblyCoordinator {
  start(message: DocumentAssemblyMessage): Promise<DocumentAssemblyJobState>;
  markRunning(): Promise<void>;
  markDone(fileId: string, fileVersionId: string): Promise<void>;
  markFailed(reason: string): Promise<void>;
  status(): Promise<DocumentAssemblyJobState>;
}
