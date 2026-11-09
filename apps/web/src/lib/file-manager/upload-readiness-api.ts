/*
 * Whether a file chosen in this browser can reach the firm's storage — asked of the server, which
 * can see what the browser cannot.
 *
 * Mirrors the `uploadReadiness.check` operation in apps/api-worker/openapi/openapi.json. The one
 * hop of an upload the application never sees is the browser's write to storage; this asks the
 * server to check every precondition of that hop from its side, where a refusal has a status code,
 * and to re-apply the settings it owns as it goes. A POST because of that re-applying: the check
 * acts, and a reader pressing it twice gets the same bucket twice. It runs from the version panel
 * (the chip at the top right), with the other reads about what is running.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";

export type UploadReadinessCheckId =
  | "bucket-recorded"
  | "bucket-exists"
  | "event-notifications"
  | "lifecycle-rules"
  | "cors-policy"
  | "key-can-sign";

/** `applied` is a repair: the setting was put in place, whether or not it was wrong before. */
export type UploadReadinessOutcome = "ok" | "applied" | "failed" | "not-applicable";

export interface UploadReadinessCheck {
  id: UploadReadinessCheckId;
  outcome: UploadReadinessOutcome;
  /** What was found, in words a person acts on. */
  detail: string;
}

export interface UploadReadinessReport {
  /** No check failed. */
  ready: boolean;
  bucketName: string | null;
  provisioner: "cloudflare-rest" | "development";
  uploadPath: "direct-to-storage" | "through-the-application";
  /** In the order the preconditions must hold: the first failure is the cause. */
  checks: UploadReadinessCheck[];
}

/** The permission the check names — the Admin key the firm's file-safety settings ride. */
export const CHECK_UPLOAD_READINESS_PERMISSION = "firm:manageScanPolicy";

export function checkUploadReadiness(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<UploadReadinessReport>> {
  return requestJson(fetchImpl, "/api/v1/firm/upload-readiness", { method: "POST" });
}

/** What each check is called on screen. The ids are the contract's; these are the reader's. */
export const UPLOAD_READINESS_CHECK_LABELS: Record<UploadReadinessCheckId, string> = {
  "bucket-recorded": "Storage bucket recorded",
  "bucket-exists": "Storage bucket exists",
  "event-notifications": "Scanning is told of new files",
  "lifecycle-rules": "Temporary artifacts expire",
  "cors-policy": "This site may write to storage",
  "key-can-sign": "The storage credential is honoured",
};
