import type {
  FirmId,
  PlatformStaffId,
  SupportGrantId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { SupportGrantTier } from "@magna-carta/data-access/support-access-statements";
import { mintSignedToken, verifySignedToken } from "../signed-token.ts";

// The bearer proof a staff principal presents after redeeming a grant. It is signed proof of "this
// principal redeemed this grant for this firm"; the live grant row (checked on every request) remains
// the source of truth for revocation and expiry. exp mirrors the grant's time-box.
//
// typ is a token-type discriminator: because support-session tokens, preview-file tokens and a meeting
// guest's credentials share the same HMAC secret and wire format, any of them would otherwise pass the
// HMAC check here. The format and the discriminator check are ../signed-token.ts; mintSupportSessionToken
// injects the type so callers never need to supply it.
export interface SupportSessionTokenPayload {
  readonly grantId: SupportGrantId;
  readonly principalId: PlatformStaffId;
  readonly firmId: FirmId;
  readonly requesterUserId: UserId;
  readonly tier: SupportGrantTier;
  readonly exp: number; // unix seconds
  readonly typ: "support-session";
}

const SUPPORT_SESSION_TYPE = "support-session";

// Callers supply everything except typ — the discriminator is injected here so callers cannot
// accidentally omit it (or set it wrong), and the type enforces it does not drift.
export async function mintSupportSessionToken(
  secret: string,
  payload: Omit<SupportSessionTokenPayload, "typ">,
): Promise<string> {
  return await mintSignedToken(secret, SUPPORT_SESSION_TYPE, payload);
}

// Returns the verified payload, or null for ANY failure (format, signature, type, expiry). Never
// throws — callers map null to a bare 401 and must never surface a server-trace handle.
export async function verifySupportSessionToken(
  secret: string,
  token: string,
  nowSeconds: number,
): Promise<SupportSessionTokenPayload | null> {
  const parsed = await verifySignedToken(secret, token, SUPPORT_SESSION_TYPE);
  if (parsed === null) return null;
  // The cast is a runtime assumption; the expiry check below and the type check above are the
  // actual guards.
  const payload = parsed as unknown as SupportSessionTokenPayload;
  if (typeof payload.exp !== "number" || payload.exp < nowSeconds) return null;
  return payload;
}
