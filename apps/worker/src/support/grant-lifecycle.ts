import type {
  SupportGrantRow,
  SupportGrantStatus,
  SupportGrantTier,
} from "@magna-carta/data-access/support-access-statements";

// Total exposure window measured from the request instant. Diagnostic is roomier (no privileged
// content at stake); privileged is tighter. The staff must redeem — and an admin must co-sign, when
// required — before this elapses.
export const GRANT_WINDOW_SECONDS: Record<SupportGrantTier, number> = {
  diagnostic: 7200,
  privileged: 3600,
};

// A grant needing co-sign is born 'requested' and only becomes redeemable once an admin approves;
// otherwise the request itself opens the redeemable window.
export function initialGrantStatus(requiresCosign: boolean): SupportGrantStatus {
  return requiresCosign ? "requested" : "active";
}

export function computeExpiresAt(tier: SupportGrantTier, nowIso: string): string {
  return new Date(Date.parse(nowIso) + GRANT_WINDOW_SECONDS[tier] * 1000).toISOString();
}

// The single per-request gate the support session resolution leans on: a grant is usable only while
// it is active AND inside its time-box. Revocation (status flip) and expiry both fail this check, so
// access dies on the next request without any token revocation list.
export function supportGrantUsable(
  row: Pick<SupportGrantRow, "status" | "expires_at">,
  nowIso: string,
): boolean {
  return row.status === "active" && Date.parse(row.expires_at) > Date.parse(nowIso);
}
