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
  readonly jobId: string;
  readonly sourceKey: string;
  readonly resultKey: string;
  readonly from: FormatId;
  readonly to: FormatId;
}

export interface ConversionCoordinator {
  start(message: ConversionMessage): Promise<ConversionJobState>; // persists queued + enqueues once
  markRunning(): Promise<void>;
  markDone(resultKey: string, mediaType: string): Promise<void>;
  markFailed(reason: string): Promise<void>;
  status(): Promise<ConversionJobState>;
}
