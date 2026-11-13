import { StoredSecretsDurableObject } from "../stored-secrets.ts";
import type { Bindings } from "../bindings.ts";
import { resolveFirmBucket } from "../files/firm-bucket.ts";
import {
  isWebSocketUpgrade,
  JobProgressSockets,
  type JobProgressAttachment,
} from "../progress/job-progress-sockets.ts";
import { isConversionProgressTerminal, resolveConversionProgress } from "./conversion-progress.ts";
import type {
  ConversionCoordinator,
  ConversionJobState,
  ConversionMessage,
} from "./conversion-types.ts";

// The single-flight coordinator for one conversion job, keyed firmId:jobId. start() persists `queued`,
// arms a stuck-job alarm, and enqueues the work exactly once; the consumer reports back through
// markRunning/markDone/markFailed; the alarm fails a job that never reports completion. The DO is the
// serialization point (bundle-coordinator precedent).
//
// It is also the push side of conversion progress: a client may subscribe over a hibernation
// WebSocket and receive queued -> running -> done/failed as it happens instead of polling. Every
// state write ends in a broadcast, and the broadcast resolves the SAME answer the poll endpoint would
// have given (conversion-progress.ts), so polling stays a complete fallback. `running` matters more
// here than in the bundle build: it is the point at which a queued job stopped waiting, which is the
// difference between "the platform is busy" and "your file is being converted".
const STUCK_DEADLINE_MS = 10 * 60 * 1000;

const UNKNOWN: ConversionJobState = {
  status: "failed",
  resultKey: null,
  mediaType: null,
  reason: "unknown job",
};

export class ConversionJob extends StoredSecretsDurableObject implements ConversionCoordinator {
  // Constructed per call: class properties do not survive hibernation, and this holds no state of its
  // own — it reads the job state back from storage and the subscriber's context off the socket.
  private progress(): JobProgressSockets<Awaited<ReturnType<typeof resolveConversionProgress>>> {
    return new JobProgressSockets(this.ctx, {
      stateFor: async (attachment: JobProgressAttachment) =>
        resolveConversionProgress(
          this.env,
          resolveFirmBucket(this.env, attachment.bucketName),
          await this.status(),
        ),
      isTerminal: isConversionProgressTerminal,
    });
  }

  // The subscribe entry point, reachable only through the conversion status route, which has already
  // run the chokepoint and addressed this object by `${sessionFirmId}:${jobId}` — the same addressing
  // the poll uses, so a firm can no more subscribe to another firm's job than it can poll one.
  override async fetch(request: Request): Promise<Response> {
    if (!isWebSocketUpgrade(request)) {
      return new Response("this endpoint serves WebSocket subscriptions only", { status: 426 });
    }
    return this.progress().accept(request);
  }

  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.progress().onMessage(socket, message);
  }

  override webSocketClose(socket: WebSocket): void {
    // A fixed normal code rather than the peer's: 1005/1006 are reported to a close handler but are
    // not valid to send. Nothing else to unwind — a subscription is the socket and nothing else.
    socket.close(1000, "peer closed");
  }

  async start(message: ConversionMessage): Promise<ConversionJobState> {
    const existing = (await this.ctx.storage.get<ConversionJobState>("state")) ?? null;
    if (existing !== null) return existing; // idempotent submit
    const state: ConversionJobState = {
      status: "queued",
      resultKey: null,
      mediaType: null,
      reason: null,
    };
    await this.ctx.storage.put("state", state);
    await this.ctx.storage.setAlarm(Date.now() + STUCK_DEADLINE_MS);
    await this.env.CONVERSION.send(message);
    // A client that minted a job id and subscribed before submitting is already watching an unknown
    // job; this is the frame that tells it the job now exists and is queued.
    await this.progress().broadcast();
    return state;
  }

  async markRunning(): Promise<void> {
    const state = await this.ctx.storage.get<ConversionJobState>("state");
    if (state === undefined || state.status !== "queued") return;
    await this.ctx.storage.put("state", { ...state, status: "running" });
    // Re-arm the alarm so the stuck-deadline covers the actual conversion window (from when
    // work starts), not only the time the job spent waiting in the queue.
    await this.ctx.storage.setAlarm(Date.now() + STUCK_DEADLINE_MS);
    await this.progress().broadcast();
  }

  async markDone(resultKey: string, mediaType: string): Promise<void> {
    const state = await this.ctx.storage.get<ConversionJobState>("state");
    // A real successful result (markDone is only called after a confirmed conversion) must win
    // over a prior timeout guess: a slow-but-eventually-successful job may have had the alarm fire
    // first. Allow overriding queued/running/failed, but never clobber an already-stored done
    // (idempotent — first done wins if the same result is delivered twice).
    if (state === undefined || state.status === "done") return;
    await this.ctx.storage.put("state", {
      status: "done",
      resultKey,
      mediaType,
      reason: null,
    });
    await this.ctx.storage.deleteAlarm();
    await this.progress().broadcast();
  }

  async markFailed(reason: string): Promise<void> {
    const state = await this.ctx.storage.get<ConversionJobState>("state");
    // A success is terminal; a stale failure from a zombie/retried attempt must not clobber `done`.
    if (state === undefined || state.status === "done" || state.status === "failed") return;
    await this.ctx.storage.put("state", { ...state, status: "failed", reason });
    await this.ctx.storage.deleteAlarm();
    await this.progress().broadcast();
  }

  async status(): Promise<ConversionJobState> {
    return (await this.ctx.storage.get<ConversionJobState>("state")) ?? UNKNOWN;
  }

  override async alarm(): Promise<void> {
    const state = await this.ctx.storage.get<ConversionJobState>("state");
    if (state !== undefined && (state.status === "queued" || state.status === "running")) {
      await this.ctx.storage.put("state", {
        ...state,
        status: "failed",
        reason: "conversion timed out",
      });
      await this.progress().broadcast();
    }
  }
}
