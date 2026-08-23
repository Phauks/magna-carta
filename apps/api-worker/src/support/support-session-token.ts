import type {
  FirmId,
  PlatformStaffId,
  SupportGrantId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { SupportGrantTier } from "@magna-carta/data-access/support-access-statements";
import { constantTimeStringEquals } from "../constant-time.ts";

// The bearer proof a staff principal presents after redeeming a grant. It is signed proof of "this
// principal redeemed this grant for this firm"; the live grant row (checked on every request) remains
// the source of truth for revocation and expiry. exp mirrors the grant's time-box.
//
// typ is a token-type discriminator: because support-session tokens and preview-file tokens share the
// same HMAC secret and wire format, a preview token would otherwise pass the HMAC check here. The
// discriminator is verified in verifySupportSessionToken; mintSupportSessionToken injects it so
// callers never need to supply it.
export interface SupportSessionTokenPayload {
  readonly grantId: SupportGrantId;
  readonly principalId: PlatformStaffId;
  readonly firmId: FirmId;
  readonly requesterUserId: UserId;
  readonly tier: SupportGrantTier;
  readonly exp: number; // unix seconds
  readonly typ: "support-session";
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecodeToBytes(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function signSegment(secret: string, segment: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(segment));
  return base64UrlEncode(signature);
}

// Callers supply everything except typ — the discriminator is injected here so callers cannot
// accidentally omit it (or set it wrong), and the type enforces it does not drift.
export async function mintSupportSessionToken(
  secret: string,
  payload: Omit<SupportSessionTokenPayload, "typ">,
): Promise<string> {
  const body = base64UrlEncode(
    encoder.encode(JSON.stringify({ ...payload, typ: "support-session" })),
  );
  const signature = await signSegment(secret, body);
  return `${body}.${signature}`;
}

// Returns the verified payload, or null for ANY failure (format, signature, expiry). Never throws —
// callers map null to a bare 401 and must never surface a server-trace handle.
export async function verifySupportSessionToken(
  secret: string,
  token: string,
  nowSeconds: number,
): Promise<SupportSessionTokenPayload | null> {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const presentedSignature = token.slice(dot + 1);
  const recomputedSignature = await signSegment(secret, body);
  // Constant-time over the two base64url signature strings (each SHA-256-folded, fixed length).
  if (!(await constantTimeStringEquals(presentedSignature, recomputedSignature))) return null;
  const bytes = base64UrlDecodeToBytes(body);
  if (bytes === null) return null;
  // Parse into a plain object first — the cast to SupportSessionTokenPayload is a runtime
  // assumption; the typ and exp checks below are the actual guards.
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(decoder.decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
  // typ discriminator: reject any token not explicitly typed as a support-session (e.g. a
  // preview-file token that shares the same secret and HMAC wire format).
  if (parsed["typ"] !== "support-session") return null;
  const payload = parsed as unknown as SupportSessionTokenPayload;
  if (typeof payload.exp !== "number" || payload.exp < nowSeconds) return null;
  return payload;
}
