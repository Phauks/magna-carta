// The ONE resolver behind both the conversion poll endpoint and the pushed socket frame, so a job is
// never reported two different ways (the bundle-progress twin, same reasoning).
//
// A `done` job is only done while its result object still exists: the coordinator's state is durable
// but a conversion result is a transient artifact the `conversions/` R2 lifecycle rule expires, so a
// state that still says `done` after the reap must report `expired` rather than hand out a signed URL
// that resolves to nothing. The URL is minted per call and never stored — it is short-lived by
// design, and storing one would outlive the reason the caller was allowed to have it.
import type { Bindings } from "../bindings.ts";
import type { FirmBucket } from "../files/firm-bucket.ts";
import { presignerForEnv } from "../files/presigner-wiring.ts";
import type { ConversionJobState } from "./conversion-types.ts";

const SIGNED_URL_TTL_SECONDS = 300;

// Exactly the body the poll endpoint returns, and exactly the `state` a pushed frame carries.
export interface ConversionProgressState {
  readonly status: "queued" | "running" | "done" | "failed" | "expired";
  readonly url?: string;
  readonly mediaType?: string;
  readonly reason?: string;
}

export async function resolveConversionProgress(
  env: Bindings,
  firmBucket: FirmBucket,
  state: ConversionJobState,
): Promise<ConversionProgressState> {
  if (state.status === "done" && state.resultKey !== null) {
    if ((await firmBucket.bucket.head(state.resultKey)) === null) return { status: "expired" };
    const url = await presignerForEnv(env).presignGet(
      firmBucket.bucketName,
      state.resultKey,
      SIGNED_URL_TTL_SECONDS,
    );
    return { status: "done", url, ...(state.mediaType !== null && { mediaType: state.mediaType }) };
  }
  return { status: state.status, ...(state.reason !== null && { reason: state.reason }) };
}

// A job that will not transition again — everything except the two in-flight states. `expired` counts:
// the result is gone and the way back is a fresh conversion, not a later frame on this job's socket.
export function isConversionProgressTerminal(state: ConversionProgressState): boolean {
  return state.status !== "queued" && state.status !== "running";
}
