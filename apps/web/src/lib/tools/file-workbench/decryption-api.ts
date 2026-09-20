/*
 * The transport for File Decryption & Recovery: unlocking a file with a known password, and
 * starting, polling, and cancelling a search for one that is not known.
 *
 * apps/web does not depend on @magna-carta/api-client ($lib/api/request.ts explains why), so this
 * hand-writes the three request/response shapes it reads, mirroring
 * apps/api-worker/src/routes/files/decryption.ts and routes/recovery.ts.
 *
 * NOTHING HERE RETAINS A FILE. Every function takes bytes, makes one request, and returns; the
 * caller decides what to do with the result. The server gives the same undertaking on its side —
 * these routes never write the file, only a redacted audit row naming its digest.
 */
import {
  problemOutcome,
  readProblem,
  requestJson,
  requestLine,
  transportOutcome,
  type ApiOutcome,
} from "$lib/api/request.ts";
import { bytesToBase64 } from "./base64.ts";

const DECRYPTION_UNLOCK_ENDPOINT = "/api/v1/decryption/unlock";
const RECOVERY_START_ENDPOINT = "/api/v1/decryption/recover";

function recoveryJobEndpoint(jobId: string): string {
  return `/api/v1/decryption/recover/${encodeURIComponent(jobId)}`;
}

export interface UnlockedFile {
  readonly decryptedBase64: string;
  readonly filenameHint?: string;
}

/**
 * Unlock a password-protected PDF, ZIP, or OOXML document with a password already in hand.
 * Attestation is a fixed `true`: the panel gates the control on the same checkbox before either
 * this or `startRecovery` can be pressed, so there is exactly one place that promise is made.
 */
export function unlockFile(
  fetchImpl: typeof fetch,
  bytes: Uint8Array,
  password: string,
): Promise<ApiOutcome<UnlockedFile>> {
  return requestJson(fetchImpl, DECRYPTION_UNLOCK_ENDPOINT, {
    method: "POST",
    body: {
      fileBase64: bytesToBase64(bytes),
      password,
      attestation: { authorized: true },
    },
  });
}

export type RecoveryTier = "cfCapable" | "gpuRequired";
export type RecoveryStatus =
  | "queued"
  | "running"
  | "found"
  | "exhausted"
  | "needsGpu"
  | "cancelled";

export interface RecoveryStarted {
  readonly jobId: string;
  readonly tier: RecoveryTier;
  readonly status: RecoveryStatus;
}

/**
 * Start a password-recovery search: extracts a recovery hash from the file and hands it to the
 * recovery coordinator, which never sees the file itself. Returns the job's id, which is the only
 * thing the recovery screen needs — reload the page, come back tomorrow, the job link still works.
 */
export function startRecovery(
  fetchImpl: typeof fetch,
  bytes: Uint8Array,
): Promise<ApiOutcome<RecoveryStarted>> {
  return requestJson(fetchImpl, RECOVERY_START_ENDPOINT, {
    method: "POST",
    body: {
      fileBase64: bytesToBase64(bytes),
      attestation: { authorized: true },
    },
  });
}

export interface RecoveryProgress {
  readonly candidatesTried: number;
  readonly shardsDone: number;
  readonly shardCount: number;
}

export interface RecoveryJobStatus {
  readonly status: RecoveryStatus;
  readonly tier: RecoveryTier;
  readonly progress: RecoveryProgress;
  /** Present only on the ONE poll that first reports `found`. Never returned again after that. */
  readonly result?: { readonly password: string };
}

/** Poll a recovery job's current state. A 404 means this member never started a job by that id. */
export function pollRecovery(
  fetchImpl: typeof fetch,
  jobId: string,
): Promise<ApiOutcome<RecoveryJobStatus>> {
  return requestJson(fetchImpl, recoveryJobEndpoint(jobId));
}

/**
 * Cancel a recovery job. A no-op, not an error, if it already reached a terminal state.
 *
 * Answers 204 with no body, so this deliberately does not go through `requestJson`: that helper
 * ends by parsing the body, and an empty one reads as a dead transport (the `removeShelfItem`
 * precedent in $lib/export/download-shelf.ts explains why) — a member would see "could not cancel"
 * over a cancellation that worked.
 */
export async function cancelRecovery(
  fetchImpl: typeof fetch,
  jobId: string,
): Promise<ApiOutcome<undefined>> {
  const path = recoveryJobEndpoint(jobId);
  const line = requestLine("DELETE", path);
  let response: Response;
  try {
    response = await fetchImpl(path, { method: "DELETE", headers: { accept: "application/json" } });
  } catch {
    return transportOutcome(line);
  }
  if (response.ok) return { kind: "ok", value: undefined };
  return problemOutcome(await readProblem(response), line);
}
