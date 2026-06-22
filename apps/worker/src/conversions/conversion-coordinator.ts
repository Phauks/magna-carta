import { DurableObject } from "cloudflare:workers";
import type { Bindings } from "../app.ts";
import type {
  ConversionCoordinator,
  ConversionJobState,
  ConversionMessage,
} from "./conversion-types.ts";

// The single-flight coordinator for one conversion job, keyed firmId:jobId. start() persists `queued`,
// arms a stuck-job alarm, and enqueues the work exactly once; the consumer reports back through
// markRunning/markDone/markFailed; the alarm fails a job that never reports completion. The DO is the
// serialization point (bundle-coordinator precedent).
const STUCK_DEADLINE_MS = 10 * 60 * 1000;

const UNKNOWN: ConversionJobState = {
  status: "failed",
  resultKey: null,
  mediaType: null,
  reason: "unknown job",
};

export class ConversionJob extends DurableObject<Bindings> implements ConversionCoordinator {
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
    return state;
  }

  async markRunning(): Promise<void> {
    const state = await this.ctx.storage.get<ConversionJobState>("state");
    if (state === undefined || state.status !== "queued") return;
    await this.ctx.storage.put("state", { ...state, status: "running" });
  }

  async markDone(resultKey: string, mediaType: string): Promise<void> {
    const state = await this.ctx.storage.get<ConversionJobState>("state");
    if (state === undefined || (state.status !== "running" && state.status !== "queued")) return;
    await this.ctx.storage.put("state", {
      status: "done",
      resultKey,
      mediaType,
      reason: null,
    });
    await this.ctx.storage.deleteAlarm();
  }

  async markFailed(reason: string): Promise<void> {
    const state = await this.ctx.storage.get<ConversionJobState>("state");
    // A success is terminal; a stale failure from a zombie/retried attempt must not clobber `done`.
    if (state === undefined || state.status === "done" || state.status === "failed") return;
    await this.ctx.storage.put("state", { ...state, status: "failed", reason });
    await this.ctx.storage.deleteAlarm();
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
    }
  }
}
