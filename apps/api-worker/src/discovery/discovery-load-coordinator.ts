import { DurableObject } from "cloudflare:workers";
import type { Bindings } from "../bindings.ts";
import {
  UNKNOWN_LOAD_JOB,
  type DiscoveryLoadCoordinatorRpc,
  type DiscoveryLoadJobState,
  type DiscoveryLoadPlanMessage,
} from "./discovery-load-types.ts";

// The coordinator for one load's fan-out, keyed firmId:loadId.
//
// EVERYTHING IT KNOWS LIVES IN DURABLE STORAGE. Not one field is held on the instance, because class
// properties do not survive hibernation and a cursor that did not survive an eviction would mean a
// load that resumed by re-allocating everything or by skipping the rest — and in discovery, either
// one is a corpus nobody can certify. A resumed turn reads the cursor back, re-plans deterministically
// from it, and re-commits idempotently: the review-document insert converges on the rows it already
// wrote rather than aborting, so a turn that committed and died before checkpointing costs a repeat
// and never a duplicate.
//
// It enqueues in chunks against the backlog rather than fanning out from a request. A load at the
// ceiling is a quarter of a million documents; a Worker handling an HTTP request does not enqueue
// that, and a coordinator that tried to do it in one turn would hit the wall-clock limit rather than
// the cursor.
//
// The SearchIndexJob DO is the shape this follows, with one difference: that job is one unit of work
// and this one is a walk over many, so this carries a cursor where that carries only a status.

// A turn that neither checkpoints nor reports within this window has stopped being a turn. The window
// covers a full chunk commit against a single-threaded database with room to spare — deliberately
// generous, because failing a load that was merely slow is worse than waiting.
const STUCK_DEADLINE_MS = 15 * 60 * 1000;

export class DiscoveryLoadCoordinator
  extends DurableObject<Bindings>
  implements DiscoveryLoadCoordinatorRpc
{
  async start(message: DiscoveryLoadPlanMessage): Promise<DiscoveryLoadJobState> {
    const existing = (await this.ctx.storage.get<DiscoveryLoadJobState>("state")) ?? null;
    // An allocated load has every row it will ever hold; a dispatched one has also been queued to be
    // read. Either way a re-declaration or a redelivery of the same load is a no-op for allocation,
    // which is what makes the declare-then-run path safe to fire more than once for one act.
    if (
      existing !== null &&
      (existing.status === "allocated" || existing.status === "dispatched")
    ) {
      return existing;
    }
    // `allocating` is shared rather than restarted: a second caller joins the turn in flight instead
    // of starting a competing walk over the same plan.
    if (existing !== null && existing.status === "allocating") return existing;

    // A waiting or failed load is legitimately restartable — that is how a load whose material
    // arrived late, or one interrupted by a deploy, picks the work back up. The cursor is CARRIED
    // FORWARD rather than reset: restarting from zero would re-walk a plan the earlier turn already
    // committed, which is wasted work at the ceiling and confusing in the progress a person watches.
    const state: DiscoveryLoadJobState = {
      status: "allocating",
      cursor: existing?.cursor ?? 0,
      plannedCount: existing?.plannedCount ?? 0,
      allocatedCount: existing?.allocatedCount ?? 0,
      dispatchCursor: existing?.dispatchCursor ?? null,
      reason: null,
    };
    await this.ctx.storage.put("state", state);
    await this.ctx.storage.put("plan", message);
    await this.ctx.storage.setAlarm(Date.now() + STUCK_DEADLINE_MS);
    return state;
  }

  // The plan the coordinator is working through, read back rather than remembered. Returned to the
  // caller that does the actual resolution and commit, because a Durable Object is where the
  // serialization point belongs and not where the firm's database writes belong.
  async plan(): Promise<DiscoveryLoadPlanMessage | null> {
    return (await this.ctx.storage.get<DiscoveryLoadPlanMessage>("plan")) ?? null;
  }

  // Advance the cursor after a chunk has COMMITTED. Called once per chunk, never per row: a
  // checkpoint per row would make the coordinator the bottleneck the chunking exists to remove.
  async checkpoint(progress: { cursor: number; allocatedCount: number }): Promise<void> {
    const state = await this.ctx.storage.get<DiscoveryLoadJobState>("state");
    if (state === undefined || state.status === "allocated") return;
    // Monotonic. A checkpoint from a stale turn cannot walk the cursor backwards and cause a
    // committed chunk to be re-planned as if it had not happened.
    await this.ctx.storage.put("state", {
      ...state,
      status: "allocating",
      cursor: Math.max(state.cursor, progress.cursor),
      allocatedCount: Math.max(state.allocatedCount, progress.allocatedCount),
      reason: null,
    });
    await this.ctx.storage.setAlarm(Date.now() + STUCK_DEADLINE_MS);
  }

  async setPlannedCount(plannedCount: number): Promise<void> {
    const state = await this.ctx.storage.get<DiscoveryLoadJobState>("state");
    if (state === undefined) return;
    await this.ctx.storage.put("state", { ...state, plannedCount });
  }

  async markAllocated(allocatedCount: number): Promise<void> {
    const state = await this.ctx.storage.get<DiscoveryLoadJobState>("state");
    // A confirmed completion is terminal and outranks every other state, including a timeout guess
    // the alarm may have written while the last chunk was still committing. `dispatched` outranks it
    // in turn: a load whose documents are already queued must not be walked back to "allocated".
    if (state === undefined || state.status === "allocated" || state.status === "dispatched")
      return;
    await this.ctx.storage.put("state", {
      ...state,
      status: "allocated",
      cursor: state.plannedCount,
      allocatedCount,
      reason: null,
    });
    await this.ctx.storage.deleteAlarm();
  }

  // Advance the PROCESSING walk after a page has been enqueued. Once per page, never per document:
  // a checkpoint per message would make the coordinator the bottleneck the paging exists to remove.
  async checkpointDispatch(cursor: string): Promise<void> {
    const state = await this.ctx.storage.get<DiscoveryLoadJobState>("state");
    if (state === undefined || state.status === "dispatched") return;
    // Monotonic, on the same reasoning the allocation cursor is: a checkpoint arriving from a stale
    // turn cannot walk the cursor backwards and cause an already-enqueued page to be re-read as if it
    // had not happened. Identifiers sort lexicographically and the walk orders by that same sort, so
    // "further along" is a string comparison.
    const furthest = state.dispatchCursor === null || cursor > state.dispatchCursor;
    await this.ctx.storage.put("state", {
      ...state,
      dispatchCursor: furthest ? cursor : state.dispatchCursor,
    });
    await this.ctx.storage.setAlarm(Date.now() + STUCK_DEADLINE_MS);
  }

  // Every document the load holds has been put on the processing lane. Terminal for the coordinator;
  // what the documents came back as is the consumer's business and the load's reconciliation.
  async markDispatched(): Promise<void> {
    const state = await this.ctx.storage.get<DiscoveryLoadJobState>("state");
    if (state === undefined) return;
    await this.ctx.storage.put("state", { ...state, status: "dispatched", reason: null });
    await this.ctx.storage.deleteAlarm();
  }

  // Parked, not broken. The load is standing work the platform owes and has not lost, and it leaves
  // this state by being started again rather than by expiring — so the alarm comes off, or a waiting
  // load would later be relabelled a timeout.
  async markWaiting(reason: string): Promise<void> {
    const state = await this.ctx.storage.get<DiscoveryLoadJobState>("state");
    if (state === undefined || state.status === "allocated" || state.status === "dispatched") {
      return;
    }
    await this.ctx.storage.put("state", { ...state, status: "waiting", reason });
    await this.ctx.storage.deleteAlarm();
  }

  async markFailed(reason: string): Promise<void> {
    const state = await this.ctx.storage.get<DiscoveryLoadJobState>("state");
    // A completed allocation is terminal; a stale failure from a retried turn must not clobber it.
    if (state === undefined || state.status === "allocated" || state.status === "dispatched") {
      return;
    }
    await this.ctx.storage.put("state", { ...state, status: "failed", reason });
    await this.ctx.storage.deleteAlarm();
  }

  async status(): Promise<DiscoveryLoadJobState> {
    return (await this.ctx.storage.get<DiscoveryLoadJobState>("state")) ?? UNKNOWN_LOAD_JOB;
  }

  override async alarm(): Promise<void> {
    const state = await this.ctx.storage.get<DiscoveryLoadJobState>("state");
    if (state !== undefined && state.status === "allocating") {
      // The cursor is kept. A timed-out load resumes from where it actually got to, which is the
      // whole reason the cursor is durable — a load that had to start over at the ceiling would be
      // hours of repeated work.
      await this.ctx.storage.put("state", {
        ...state,
        status: "failed",
        reason: "load fan-out timed out",
      });
    }
  }
}
