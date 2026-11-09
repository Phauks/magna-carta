import { DurableObject } from "cloudflare:workers";
import type { Bindings } from "../bindings.ts";
import { resolveFirmBucket } from "../files/firm-bucket.ts";
import {
  isWebSocketUpgrade,
  JobProgressSockets,
  type JobProgressAttachment,
} from "../progress/job-progress-sockets.ts";
import type { BuildResultVolume } from "./bundle-container-adapter.ts";
import { isBundleProgressTerminal, resolveBundleProgress } from "./bundle-progress.ts";
import type { BundleBuildMessage, BundleCoordinator, BundleJobState } from "./bundle-types.ts";

// The single-flight coordinator for one bulk-download artifact, keyed firmId:manifestHash. The first
// request persists a `building` state, arms a stuck-job alarm, and enqueues the build exactly once;
// identical concurrent requests find the existing state and share that one build. The build consumer
// reports completion through markReady/markFailed; the alarm fails a build that never reported back.
// This is the codebase's first Durable Object — the DO is the serialization point that makes the
// check-then-enqueue atomic across concurrent requests (per-firm: the name carries the firm id).
//
// It is also the push side of bundle progress. A client may subscribe over a hibernation WebSocket
// (fetch with an Upgrade header, from the status route, after the chokepoint) and receive each
// transition as it happens instead of polling for it. Every state write below therefore ends in a
// broadcast, and the broadcast resolves the SAME answer the poll endpoint would have given
// (bundle-progress.ts). Subscribers cost nothing while they wait: the object hibernates with its
// sockets open, and keepalives are answered by the runtime without waking it.

const STUCK_DEADLINE_MS = 10 * 60 * 1000;

export class BundleBuildCoordinator extends DurableObject<Bindings> implements BundleCoordinator {
  // Constructed per call: class properties do not survive hibernation, and this holds no state of its
  // own — it reads the job state back from storage and the subscriber's context off the socket.
  private progress(): JobProgressSockets<Awaited<ReturnType<typeof resolveBundleProgress>>> {
    return new JobProgressSockets(this.ctx, {
      stateFor: async (attachment: JobProgressAttachment) =>
        resolveBundleProgress(
          this.env,
          resolveFirmBucket(this.env, attachment.bucketName),
          await this.status(),
        ),
      isTerminal: isBundleProgressTerminal,
    });
  }

  // The subscribe entry point. Only reachable through the status route, which has already run the
  // chokepoint and addressed this object by `${sessionFirmId}:${manifestHash}` — the same addressing
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
    // Close this end too, so a half-closed socket is not left for the runtime to reap. A fixed normal
    // code rather than the peer's: 1005/1006 are reported to a close handler but are not valid to
    // send, so echoing the incoming code is a throw waiting to happen. There is no per-subscriber
    // bookkeeping to unwind — a subscription is the socket and nothing else.
    socket.close(1000, "peer closed");
  }

  async requestBundle(message: BundleBuildMessage): Promise<BundleJobState> {
    // THE DECISION IS GATED, and it has to be, because deciding requires a round trip that is not
    // storage. workerd holds the input gate across a storage await, so an ordinary read-then-write in
    // this object is already single-flight: a second request is not delivered until the first has
    // written, and it then sees `building` and shares. The reaped-artifact branch breaks that — it
    // HEADs R2 to find out whether the bundle still exists, and a non-storage await opens the gate
    // mid-decision. Both requests then read `ready`, both find the object gone, and both enqueue a
    // rebuild of a bundle that may be very large. blockConcurrencyWhile delivers nothing else while
    // it runs, which is what makes read-decide-write one act again.
    //
    // The enqueue and the push stay OUTSIDE it: they are the consequence of having decided, not part
    // of deciding, and holding the gate across a queue send would stall every poll on this job behind
    // it for no benefit — a request delivered after the gate reopens reads `building` and shares.
    const decision = await this.ctx.blockConcurrencyWhile<
      { build: false; state: BundleJobState } | { build: true; state: BundleJobState }
    >(async () => {
      const existing = (await this.ctx.storage.get<BundleJobState>("state")) ?? null;
      // A build still in flight is always shared — that is the single-flight dedup this DO exists for.
      if (existing !== null && existing.status === "building")
        return { build: false, state: existing };
      // A `ready` job is shared only while its artifact is still there. This DO's state is durable but
      // the artifact is not: the `bundles/` R2 lifecycle rule expires the object, and a bundle whose
      // object has been reaped would otherwise keep reporting `ready` with a key that no longer resolves
      // and could never be rebuilt. Treating a missing artifact as rebuildable is what makes the
      // artifact a regenerable cache rather than a one-shot. A `failed` job always rebuilds.
      if (
        existing !== null &&
        existing.status === "ready" &&
        (await this.artifactsPresent(
          existing,
          resolveFirmBucket(this.env, message.bucketName).bucket,
        ))
      ) {
        return { build: false, state: existing };
      }
      const state: BundleJobState = {
        status: "building",
        manifestHash: message.manifestHash,
        r2Key: null,
        error: null,
      };
      await this.ctx.storage.put("state", state);
      await this.ctx.storage.setAlarm(Date.now() + STUCK_DEADLINE_MS);
      return { build: true, state };
    });

    if (!decision.build) return decision.state;
    await this.env.BUNDLE_BUILD.send(message);
    // A rebuild of a job someone is already watching (a `failed` retried, or a `ready` whose artifact
    // was reaped) moves them back to `building` — the shared-build paths above transitioned nothing
    // and have nothing to push.
    await this.progress().broadcast();
    return decision.state;
  }

  // True only when every artifact a `ready` state recorded is still in the firm's bucket. The optioned
  // container lane records N volumes (a 7z split is unusable if any single volume is gone), the plain
  // client-zip lane records one key. A `ready` state recording neither is nothing the client can be
  // handed, so it counts as missing and rebuilds.
  private async artifactsPresent(state: BundleJobState, bucket: R2Bucket): Promise<boolean> {
    if (state.volumes !== undefined) {
      if (state.volumes.length === 0) return false;
      // One round trip for the whole set, not one per volume in series — a split bundle can carry many.
      const heads = await Promise.all(state.volumes.map((volume) => bucket.head(volume.key)));
      return heads.every((head) => head !== null);
    }
    if (state.r2Key === null) return false;
    return (await bucket.head(state.r2Key)) !== null;
  }

  async markReady(r2Key: string): Promise<void> {
    const state = await this.ctx.storage.get<BundleJobState>("state");
    if (state === undefined) return;
    // Clear any error from a prior failed attempt: a job can legitimately go failed -> building ->
    // ready (a retried build that succeeds), and a ready state must not carry a stale error string.
    await this.ctx.storage.put("state", { ...state, status: "ready", r2Key, error: null });
    await this.ctx.storage.deleteAlarm();
    await this.progress().broadcast();
  }

  async markReadyVolumes(volumes: readonly BuildResultVolume[]): Promise<void> {
    const state = await this.ctx.storage.get<BundleJobState>("state");
    if (state === undefined) return;
    // The optioned container lane's completion: it reports N volume keys (one for a single-file
    // bundle, several for a 7z split) instead of a single r2Key. Mirror markReady — clear any stale
    // error from a prior failed attempt and disarm the stuck alarm. r2Key stays null on this path.
    await this.ctx.storage.put("state", { ...state, status: "ready", volumes, error: null });
    await this.ctx.storage.deleteAlarm();
    await this.progress().broadcast();
  }

  async markFailed(error: string): Promise<void> {
    const state = await this.ctx.storage.get<BundleJobState>("state");
    // Only a job still `building` becomes failed. A zombie attempt from a prior (timed-out or retried)
    // build must never clobber a `ready` a later attempt already produced — that would lose the
    // completion the client may have already polled. A success is terminal; a stale failure is dropped.
    if (state === undefined || state.status !== "building") return;
    await this.ctx.storage.put("state", { ...state, status: "failed", error });
    await this.ctx.storage.deleteAlarm();
    await this.progress().broadcast();
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
      await this.progress().broadcast();
    }
  }
}
