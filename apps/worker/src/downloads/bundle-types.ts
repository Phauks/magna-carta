// The shared shapes for the async bulk-download build: the job state the coordinator Durable Object
// persists, the queue message the build consumer reads, and the DO RPC surface the download route and
// the consumer both call. One home so the DO, the consumer, and both routes never drift on field names.

export type BundleJobStatus = "building" | "ready" | "failed";

export interface BundleJobState {
  readonly status: BundleJobStatus;
  readonly manifestHash: string;
  readonly r2Key: string | null; // set when ready
  readonly error: string | null; // set when failed
}

export interface BundleBuildMessage {
  readonly firmId: string;
  readonly bucketName: string;
  readonly manifestHash: string;
  readonly entries: readonly { readonly r2Key: string; readonly path: string }[];
}

// The DO RPC surface the route + consumer call.
export interface BundleCoordinator {
  requestBundle(message: BundleBuildMessage): Promise<BundleJobState>; // single-flight: enqueues on first call
  markReady(r2Key: string): Promise<void>;
  markFailed(error: string): Promise<void>;
  status(): Promise<BundleJobState>;
}
