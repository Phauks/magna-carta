import { DurableObject } from "cloudflare:workers";
import type { Bindings } from "../app.ts";
import type {
  DocumentAssemblyCoordinator,
  DocumentAssemblyJobState,
  DocumentAssemblyMessage,
} from "./assembly-types.ts";

// The single-flight coordinator for one assembly job, keyed firmId:assemblyId. start() persists
// `queued`, arms a stuck-job alarm, and enqueues the work exactly once; the consumer reports back
// through markRunning / markDone / markFailed; the alarm fails a job that never reports.
//
// Assembly is asynchronous from the first line of code even though a single small merge would fit in a
// request: the batch assembly a matter plan will submit is the same code path, the DOCX-to-PDF hop lands
// in a later slice and is genuinely long, and a job gives the interface a state to poll rather than a
// request to hold open. Retrofitting a synchronous route into a job later costs exactly as much as
// building it twice.

// A merge over an already-normalized template is fast, but the job also stages an upload, writes an
// object, and drives the ingest gate. Ten minutes is the same ceiling the other job coordinators use.
const STUCK_DEADLINE_MS = 10 * 60 * 1000;

const UNKNOWN: DocumentAssemblyJobState = {
  status: "failed",
  fileId: null,
  fileVersionId: null,
  reason: "unknown-assembly",
};

export class DocumentAssemblyJob
  extends DurableObject<Bindings>
  implements DocumentAssemblyCoordinator
{
  async start(message: DocumentAssemblyMessage): Promise<DocumentAssemblyJobState> {
    const existing = (await this.ctx.storage.get<DocumentAssemblyJobState>("state")) ?? null;
    if (existing !== null) return existing; // idempotent submit — a retried request never files twice
    const state: DocumentAssemblyJobState = {
      status: "queued",
      fileId: null,
      fileVersionId: null,
      reason: null,
    };
    await this.ctx.storage.put("state", state);
    await this.ctx.storage.setAlarm(Date.now() + STUCK_DEADLINE_MS);
    await this.env.DOCUMENT_ASSEMBLY.send(message);
    return state;
  }

  async markRunning(): Promise<void> {
    const state = await this.ctx.storage.get<DocumentAssemblyJobState>("state");
    if (state === undefined || state.status !== "queued") return;
    await this.ctx.storage.put("state", { ...state, status: "running" });
    // Re-arm so the stuck deadline covers the actual assembly window, not only the queue wait.
    await this.ctx.storage.setAlarm(Date.now() + STUCK_DEADLINE_MS);
  }

  async markDone(fileId: string, fileVersionId: string): Promise<void> {
    const state = await this.ctx.storage.get<DocumentAssemblyJobState>("state");
    // A confirmed filing must win over a prior timeout guess — a slow-but-successful job may have had
    // the alarm fire first — but an already-stored done is never clobbered, so a redelivered message
    // reporting the same result is a no-op rather than a second document.
    if (state === undefined || state.status === "done") return;
    await this.ctx.storage.put("state", {
      status: "done",
      fileId,
      fileVersionId,
      reason: null,
    });
    await this.ctx.storage.deleteAlarm();
  }

  async markFailed(reason: string): Promise<void> {
    const state = await this.ctx.storage.get<DocumentAssemblyJobState>("state");
    // A success is terminal; a stale failure from a retried attempt must not clobber `done`.
    if (state === undefined || state.status === "done" || state.status === "failed") return;
    await this.ctx.storage.put("state", { ...state, status: "failed", reason });
    await this.ctx.storage.deleteAlarm();
  }

  async status(): Promise<DocumentAssemblyJobState> {
    return (await this.ctx.storage.get<DocumentAssemblyJobState>("state")) ?? UNKNOWN;
  }

  override async alarm(): Promise<void> {
    const state = await this.ctx.storage.get<DocumentAssemblyJobState>("state");
    if (state !== undefined && (state.status === "queued" || state.status === "running")) {
      await this.ctx.storage.put("state", {
        ...state,
        status: "failed",
        reason: "assembly-timed-out",
      });
    }
  }
}
