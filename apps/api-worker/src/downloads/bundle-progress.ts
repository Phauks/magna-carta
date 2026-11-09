// Turns the coordinator's persisted job state into the answer a client is given — the ONE resolver
// behind both the poll endpoint and the pushed socket frame, so the two can never report a job
// differently. Polling stays the fallback, and "fallback" only means anything if it is the same
// answer.
//
// Two facts live here rather than at either call site. First, a `ready` job is only ready if its
// artifact is still in the bucket: the coordinator's state is durable, the artifact is not (the
// `bundles/` R2 lifecycle rule expires it), so a state that says `ready` with a key that no longer
// resolves must report `expired` and let the client ask for a rebuild. Second, a split bundle is
// all-or-nothing — one missing volume makes the archive unusable, so any miss expires the whole job.
//
// The signed URL is minted per call and never stored: it is short-lived by design, and a URL held in
// durable state would outlive the reason the caller was allowed to have it.
import type { Bindings } from "../bindings.ts";
import type { FirmBucket } from "../files/firm-bucket.ts";
import { presignerForEnv } from "../files/presigner-wiring.ts";
import type { BundleJobState } from "./bundle-types.ts";

const SIGNED_URL_TTL_SECONDS = 300;

// Exactly the body the poll endpoint returns, and exactly the `state` a pushed frame carries.
export interface BundleProgressState {
  readonly status: "building" | "ready" | "failed" | "expired";
  readonly url?: string;
  readonly urls?: string[];
}

export async function resolveBundleProgress(
  env: Bindings,
  firmBucket: FirmBucket,
  state: BundleJobState,
): Promise<BundleProgressState> {
  if (state.status === "ready" && state.volumes !== undefined) {
    const presigner = presignerForEnv(env);
    const urls: string[] = [];
    for (const volume of state.volumes) {
      if ((await firmBucket.bucket.head(volume.key)) === null) return { status: "expired" };
      urls.push(
        await presigner.presignGet(firmBucket.bucketName, volume.key, SIGNED_URL_TTL_SECONDS),
      );
    }
    return { status: "ready", urls };
  }

  if (state.status === "ready" && state.r2Key !== null) {
    if ((await firmBucket.bucket.head(state.r2Key)) === null) return { status: "expired" };
    const url = await presignerForEnv(env).presignGet(
      firmBucket.bucketName,
      state.r2Key,
      SIGNED_URL_TTL_SECONDS,
    );
    return { status: "ready", url };
  }

  return { status: state.status };
}

// A job in one of these states will not transition again, so a subscriber has everything it is going
// to get. `expired` counts: the artifact is gone, and the way back is a new build request, not a
// later frame on this job's socket.
export function isBundleProgressTerminal(state: BundleProgressState): boolean {
  return state.status !== "building";
}
