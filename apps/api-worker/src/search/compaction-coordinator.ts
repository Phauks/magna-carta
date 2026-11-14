import { StoredSecretsDurableObject } from "../stored-secrets.ts";
import type { Bindings } from "../bindings.ts";
import type {
  SearchCompactionCoordinator,
  SearchCompactionMessage,
  SearchCompactionStartOutcome,
  SearchCompactionState,
} from "./compaction-types.ts";

// The single-flight coordinator for one corpus's compaction, keyed firmId:corpusId. start() persists
// `queued`, arms a stuck-pass alarm, and enqueues the work exactly once; the consumer reports back; the
// alarm fails a pass that never reports at all. SearchIndexJob is the shape this follows.
//
// THE ONE DIFFERENCE FROM THE INDEX JOB, and it is the reason this object exists at all: an index job is
// keyed by a document version, which is a unit of work that either happens or does not, so a duplicate is
// merely wasteful. A compaction is keyed by a corpus, and two concurrent passes over one corpus are
// actively wrong — each would select overlapping splits, merge them separately, and the second batch to
// commit would supersede sources the first had already merged, leaving one merged split live over
// documents another live merged split also holds. Every document in the overlap would then match twice.
// Single-flighting per corpus is what makes that unrepresentable.
//
// There is also no attempt bound here, unlike the index job's per-generation cap. A compaction has no
// permanently-unreadable case to protect against: it reads splits the platform itself wrote and can
// always read, so a repeated failure is an outage or a defect, not a document that will never parse.
// Bounding it would quietly stop maintaining a corpus.
const STUCK_DEADLINE_MS = 30 * 60 * 1000;

const IDLE: SearchCompactionState = {
  status: "skipped",
  objectKey: null,
  mergedSplits: 0,
  reason: "no compaction has run for this corpus",
  startedAt: null,
};

// Statuses a pass is still occupying the corpus in. A start() while the corpus is in one of these is
// refused — that is the single-flight.
function inFlight(status: SearchCompactionState["status"]): boolean {
  return status === "queued" || status === "running";
}

export class SearchCompactionJob
  extends StoredSecretsDurableObject
  implements SearchCompactionCoordinator
{
  async start(message: SearchCompactionMessage): Promise<SearchCompactionStartOutcome> {
    const existing = (await this.ctx.storage.get<SearchCompactionState>("state")) ?? null;
    if (existing !== null && inFlight(existing.status)) {
      return { state: existing, started: false };
    }
    // Every terminal state is legitimately re-startable, including `compacted`: a corpus that was
    // compacted an hour ago and has since gained a hundred splits needs compacting again, and a pass is
    // bounded, so a corpus over the bound converges through repeated passes rather than one large merge.
    const state: SearchCompactionState = {
      status: "queued",
      objectKey: null,
      mergedSplits: 0,
      reason: null,
      startedAt: new Date().toISOString(),
    };
    await this.ctx.storage.put("state", state);
    await this.ctx.storage.setAlarm(Date.now() + STUCK_DEADLINE_MS);
    await this.env.SEARCH_COMPACTION.send(message);
    return { state, started: true };
  }

  async markRunning(): Promise<void> {
    const state = await this.ctx.storage.get<SearchCompactionState>("state");
    if (state === undefined || state.status !== "queued") return;
    await this.ctx.storage.put("state", { ...state, status: "running" });
    // Re-arm so the deadline covers the merge rather than the queue wait. A merge reads and rewrites
    // every byte of its source splits, so it is the long part.
    await this.ctx.storage.setAlarm(Date.now() + STUCK_DEADLINE_MS);
  }

  async markCompacted(objectKey: string, mergedSplits: number): Promise<void> {
    const state = await this.ctx.storage.get<SearchCompactionState>("state");
    if (state === undefined) return;
    await this.ctx.storage.put("state", {
      ...state,
      status: "compacted",
      objectKey,
      mergedSplits,
      reason: null,
    });
    await this.ctx.storage.deleteAlarm();
  }

  async markSkipped(reason: string): Promise<void> {
    await this.settle("skipped", reason);
  }

  async markDeferred(reason: string): Promise<void> {
    await this.settle("deferred", reason);
  }

  async markFailed(reason: string): Promise<void> {
    await this.settle("failed", reason);
  }

  private async settle(status: SearchCompactionState["status"], reason: string): Promise<void> {
    const state = await this.ctx.storage.get<SearchCompactionState>("state");
    if (state === undefined) return;
    await this.ctx.storage.put("state", {
      ...state,
      status,
      objectKey: null,
      mergedSplits: 0,
      reason,
    });
    // The corpus is released either way: a pass that skipped, deferred, or failed is holding nothing, and
    // leaving the alarm armed would later relabel a settled pass a timeout.
    await this.ctx.storage.deleteAlarm();
  }

  async status(): Promise<SearchCompactionState> {
    return (await this.ctx.storage.get<SearchCompactionState>("state")) ?? IDLE;
  }

  override async alarm(): Promise<void> {
    const state = await this.ctx.storage.get<SearchCompactionState>("state");
    if (state !== undefined && inFlight(state.status)) {
      // Releasing the corpus is the point. A pass that never reported may have published its object and
      // died before committing the swap; that is safe to redo, because the merged split's key is derived
      // from its sources, so the retry overwrites the same object. Leaving the corpus locked forever
      // would be the worse failure — it would silently stop maintaining that matter's index.
      await this.ctx.storage.put("state", {
        ...state,
        status: "failed",
        objectKey: null,
        mergedSplits: 0,
        reason: "compaction pass timed out",
      });
    }
  }
}
