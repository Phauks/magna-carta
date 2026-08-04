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
    // A build still in flight is always shared — that is the single-flight dedup this DO exists for.
    if (existing !== null && existing.status === "building") return existing;
    // A `ready` job is shared only while its artifact is still there. This DO's state is durable but
    // the artifact is not: the `bundles/` R2 lifecycle rule expires the object, and a bundle whose
    // object has been reaped would otherwise keep reporting `ready` with a key that no longer resolves
    // and could never be rebuilt. Treating a missing artifact as rebuildable is what makes the
    // artifact a regenerable cache rather than a one-shot. A `failed` job always rebuilds.
    if (
      existing !== null &&
      existing.status === "ready" &&
      (await this.artifactsPresent(existing))
    ) {
      return existing;
    }
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

  // True only when every artifact a `ready` state recorded is still in the firm's bucket. The optioned
  // container lane records N volumes (a 7z split is unusable if any single volume is gone), the plain
  // client-zip lane records one key. A `ready` state recording neither is nothing the client can be
  // handed, so it counts as missing and rebuilds.
  private async artifactsPresent(state: BundleJobState): Promise<boolean> {
    if (state.volumes !== undefined) {
      if (state.volumes.length === 0) return false;
      // One round trip for the whole set, not one per volume in series — a split bundle can carry many.
      const heads = await Promise.all(state.volumes.map((volume) => this.env.R2.head(volume.key)));
      return heads.every((head) => head !== null);
    }
    if (state.r2Key === null) return false;
    return (await this.env.R2.head(state.r2Key)) !== null;
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
