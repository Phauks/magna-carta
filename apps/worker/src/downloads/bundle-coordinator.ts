import { DurableObject } from "cloudflare:workers";
import type { Bindings } from "../app.ts";
import type { BuildResultVolume } from "./bundle-container-adapter.ts";
import type { BundleBuildMessage, BundleCoordinator, BundleJobState } from "./bundle-types.ts";

// The single-flight coordinator for one bulk-download artifact, keyed firmId:manifestHash. The first
// request persists a `building` state, arms a stuck-job alarm, and enqueues the build exactly once;
// identical concurrent requests find the existing state and share that one build. The build consumer
// reports completion through markReady/markFailed; the alarm fails a build that never reported back.
// This is the codebase's first Durable Object — the DO is the serialization point that makes the
// check-then-enqueue atomic across concurrent requests (per-firm: the name carries the firm id).

const STUCK_DEADLINE_MS = 10 * 60 * 1000;

export class BundleBuildCoordinator extends DurableObject<Bindings> implements BundleCoordinator {
  async requestBundle(message: BundleBuildMessage): Promise<BundleJobState> {
    const existing = (await this.ctx.storage.get<BundleJobState>("state")) ?? null;
    // A live (building/ready) job is shared; only a previously failed job is rebuilt.
    if (existing !== null && existing.status !== "failed") return existing;
    const state: BundleJobState = {
      status: "building",
      manifestHash: message.manifestHash,
      r2Key: null,
      error: null,
    };
    await this.ctx.storage.put("state", state);
    await this.ctx.storage.setAlarm(Date.now() + STUCK_DEADLINE_MS);
    await this.env.BUNDLE_BUILD.send(message);
    return state;
  }

  async markReady(r2Key: string): Promise<void> {
    const state = await this.ctx.storage.get<BundleJobState>("state");
    if (state === undefined) return;
    // Clear any error from a prior failed attempt: a job can legitimately go failed -> building ->
    // ready (a retried build that succeeds), and a ready state must not carry a stale error string.
    await this.ctx.storage.put("state", { ...state, status: "ready", r2Key, error: null });
    await this.ctx.storage.deleteAlarm();
  }

  async markReadyVolumes(volumes: readonly BuildResultVolume[]): Promise<void> {
    const state = await this.ctx.storage.get<BundleJobState>("state");
    if (state === undefined) return;
    // The optioned container lane's completion: it reports N volume keys (one for a single-file
    // bundle, several for a 7z split) instead of a single r2Key. Mirror markReady — clear any stale
    // error from a prior failed attempt and disarm the stuck alarm. r2Key stays null on this path.
    await this.ctx.storage.put("state", { ...state, status: "ready", volumes, error: null });
    await this.ctx.storage.deleteAlarm();
  }

  async markFailed(error: string): Promise<void> {
    const state = await this.ctx.storage.get<BundleJobState>("state");
    // Only a job still `building` becomes failed. A zombie attempt from a prior (timed-out or retried)
    // build must never clobber a `ready` a later attempt already produced — that would lose the
    // completion the client may have already polled. A success is terminal; a stale failure is dropped.
    if (state === undefined || state.status !== "building") return;
    await this.ctx.storage.put("state", { ...state, status: "failed", error });
    await this.ctx.storage.deleteAlarm();
  }

  async status(): Promise<BundleJobState> {
    return (
      (await this.ctx.storage.get<BundleJobState>("state")) ?? {
        status: "failed",
        manifestHash: "",
        r2Key: null,
        error: "unknown job",
      }
    );
  }

  override async alarm(): Promise<void> {
    const state = await this.ctx.storage.get<BundleJobState>("state");
    if (state?.status === "building") {
      await this.ctx.storage.put("state", { ...state, status: "failed", error: "build timed out" });
    }
  }
}
