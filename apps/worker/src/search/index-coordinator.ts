import { DurableObject } from "cloudflare:workers";
import type { Bindings } from "../app.ts";
import type {
  SearchIndexCoordinator,
  SearchIndexJobState,
  SearchIndexMessage,
} from "./index-types.ts";

// The single-flight coordinator for one document version's index job, keyed firmId:documentId:version.
// start() persists `queued`, arms a stuck-job alarm, and enqueues the work exactly once; the consumer
// reports back through markRunning/markIndexed/markDeferred/markFailed; the alarm fails a job that never
// reports at all. The ConversionJob DO is the shape this follows.
//
// The one difference from conversion is `deferred`, and it is deliberate: a conversion whose engine is
// missing is a user-visible request that failed, while an index job whose engine is missing is
// background work the platform owes and has not lost. Recording that distinctly is what makes the
// backlog answerable — "how many documents are waiting on the engine" is a state, not an error rate.
const STUCK_DEADLINE_MS = 15 * 60 * 1000;

const UNKNOWN: SearchIndexJobState = {
  status: "failed",
  objectKey: null,
  reason: "unknown job",
};

export class SearchIndexJob extends DurableObject<Bindings> implements SearchIndexCoordinator {
  async start(message: SearchIndexMessage): Promise<SearchIndexJobState> {
    const existing = (await this.ctx.storage.get<SearchIndexJobState>("state")) ?? null;
    // An already-indexed job is done: a re-enqueue of the same version is a no-op, which is what makes
    // the ingest path safe to fire more than once for one commit.
    if (existing !== null && existing.status !== "deferred" && existing.status !== "failed") {
      return existing;
    }
    // A deferred or failed job is legitimately re-startable — that is how a replay after the engine is
    // deployed, or after a transient outage, picks the work back up.
    const state: SearchIndexJobState = { status: "queued", objectKey: null, reason: null };
    await this.ctx.storage.put("state", state);
    await this.ctx.storage.setAlarm(Date.now() + STUCK_DEADLINE_MS);
    await this.env.SEARCH_INDEX.send(message);
    return state;
  }

  async markRunning(): Promise<void> {
    const state = await this.ctx.storage.get<SearchIndexJobState>("state");
    if (state === undefined || state.status !== "queued") return;
    await this.ctx.storage.put("state", { ...state, status: "running" });
    // Re-arm so the deadline covers the extract+build window rather than the queue wait.
    await this.ctx.storage.setAlarm(Date.now() + STUCK_DEADLINE_MS);
  }

  async markIndexed(objectKey: string): Promise<void> {
    const state = await this.ctx.storage.get<SearchIndexJobState>("state");
    // A confirmed publish is terminal and outranks every other state, including a timeout guess the
    // alarm may have written while the build was still finishing. First publish wins on a redelivery.
    if (state === undefined || state.status === "indexed") return;
    await this.ctx.storage.put("state", { status: "indexed", objectKey, reason: null });
    await this.ctx.storage.deleteAlarm();
  }

  async markDeferred(reason: string): Promise<void> {
    const state = await this.ctx.storage.get<SearchIndexJobState>("state");
    if (state === undefined || state.status === "indexed") return;
    await this.ctx.storage.put("state", { status: "deferred", objectKey: null, reason });
    // The job is parked, not running: drop the alarm so a deferred job is not later relabelled a
    // timeout. It leaves this state by being enqueued again, never by expiry.
    await this.ctx.storage.deleteAlarm();
  }

  async markFailed(reason: string): Promise<void> {
    const state = await this.ctx.storage.get<SearchIndexJobState>("state");
    // A success is terminal; a stale failure from a retried attempt must not clobber it.
    if (state === undefined || state.status === "indexed") return;
    await this.ctx.storage.put("state", { status: "failed", objectKey: null, reason });
    await this.ctx.storage.deleteAlarm();
  }

  async status(): Promise<SearchIndexJobState> {
    return (await this.ctx.storage.get<SearchIndexJobState>("state")) ?? UNKNOWN;
  }

  override async alarm(): Promise<void> {
    const state = await this.ctx.storage.get<SearchIndexJobState>("state");
    if (state !== undefined && (state.status === "queued" || state.status === "running")) {
      await this.ctx.storage.put("state", {
        status: "failed",
        objectKey: null,
        reason: "index job timed out",
      });
    }
  }
}
