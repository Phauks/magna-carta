import type { FormatId } from "@magna-carta/conversion/format";

// The job state the coordinator Durable Object persists; the queue message the consumer reads; the DO
// RPC surface the routes + consumer call. One home so they never drift on field names (bundle-types
// precedent).
export type ConversionJobStatus = "queued" | "running" | "done" | "failed";

export interface ConversionJobState {
  readonly status: ConversionJobStatus;
  readonly resultKey: string | null; // set when done
  readonly mediaType: string | null; // set when done — the converted file's media type
  readonly reason: string | null; // a typed ConversionResult reason or an error string, when failed
}

export interface ConversionMessage {
  readonly firmId: string;
  // The firm's recorded R2 bucket, resolved by the submitting route through files/firm-bucket.ts and
  // carried on the message so the consumer reads the source and writes the result through the SAME
  // seam — and therefore the same bucket the upload was presigned against. Re-deriving it in the
  // consumer would let a firm re-provisioned mid-flight read a job's bytes from a different bucket
  // than the one they were written to (bundle-types precedent).
  readonly bucketName: string;
  readonly jobId: string;
  readonly sourceKey: string;
  readonly resultKey: string;
  readonly from: FormatId;
  readonly to: FormatId;
}

// A request for a video version's playable copy (packages/file-manager/src/playable-copy.ts). It
// rides the conversion queue because it is the same kind of work — CPU-bound in an engine Container,
// at the lane's low concurrency, dead-lettered after its retries — but it is not a ConversionJob: its
// state lives on the version's own row, where every reader of that version already looks, so it has
// no coordinator object. `kind` tells the two apart; a ConversionMessage carries none, so a message
// already in flight when this shape arrived still routes where it was going.
export interface PlayableCopyMessage {
  readonly kind: "playable-copy";
  readonly firmId: string;
  // The firm's recorded bucket, carried for the same reason a ConversionMessage carries it.
  readonly bucketName: string;
  readonly versionId: string;
  // Who asked: the filed copy is recorded as uploaded by them. Optional so a message sent before the
  // copy was filed still parses; such a copy is filed with no uploader.
  readonly requestedBy?: string;
}

export type ConversionQueueMessage = ConversionMessage | PlayableCopyMessage;

export function isPlayableCopyMessage(
  message: ConversionQueueMessage,
): message is PlayableCopyMessage {
  return "kind" in message && message.kind === "playable-copy";
}

export interface ConversionCoordinator {
  start(message: ConversionMessage): Promise<ConversionJobState>; // persists queued + enqueues once
  markRunning(): Promise<void>;
  markDone(resultKey: string, mediaType: string): Promise<void>;
  markFailed(reason: string): Promise<void>;
  status(): Promise<ConversionJobState>;
}
