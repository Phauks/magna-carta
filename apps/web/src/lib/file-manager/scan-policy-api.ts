/*
 * The firm's malware scan policy — what its uploads are scanned against, and what happens to a file
 * that fails.
 *
 * Mirrors the `scanPolicy.get` and `scanPolicy.update` operations in
 * apps/api-worker/openapi/openapi.json. The same policy is read by the ingest consumer at
 * queue-consume time and by the download route at access time, so a change here reaches both
 * without re-ingesting anything.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";

/**
 * How wide a net the scan casts. The engine's rule corpus is tiered, and a match only counts when
 * it falls within the firm's tier — so `full` flags the most and `core` the least.
 */
export type ScanTier = "core" | "extended" | "full";

/** What happens to a file the scan flagged. There is deliberately no reject-or-delete option. */
export type FlaggedTreatment = "block" | "informed-access" | "allow-and-flag";

export interface ScanPolicySettings {
  policy: {
    tier: ScanTier;
    /**
     * The score at or above which a SUSPICIOUS match counts. A lower floor flags more, because
     * more of the engine's weaker signals clear it.
     */
    suspiciousScoreFloor: number;
  };
  flaggedTreatment: FlaggedTreatment;
  /** Whether a flagged download asks the member to prove who they are again. */
  stepUpReauthOnFlagged: boolean;
}

/** A sparse change to the policy. An absent field is left exactly as it stands. */
export interface ScanPolicyPatch {
  policy?: { tier: ScanTier; suspiciousScoreFloor: number };
  flaggedTreatment?: FlaggedTreatment;
  stepUpReauthOnFlagged?: boolean;
}

/** The permission both the read and the write name. A member without it is refused server-side. */
export const MANAGE_SCAN_POLICY_PERMISSION = "firm:manageScanPolicy";

export function readScanPolicy(fetchImpl: typeof fetch): Promise<ApiOutcome<ScanPolicySettings>> {
  return requestJson(fetchImpl, "/api/v1/firm/scan-policy");
}

export function updateScanPolicy(
  fetchImpl: typeof fetch,
  patch: ScanPolicyPatch,
  idempotencyKey: string,
): Promise<ApiOutcome<ScanPolicySettings>> {
  return requestJson(fetchImpl, "/api/v1/firm/scan-policy", {
    method: "PATCH",
    body: patch,
    idempotencyKey,
  });
}
