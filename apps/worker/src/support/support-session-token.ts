import type { FirmId, PlatformStaffId, SupportGrantId, UserId } from "@magna-carta/identifiers/types";
import type { SupportGrantTier } from "@magna-carta/data-access/support-access-statements";
import { constantTimeStringEquals } from "../constant-time.ts";

// The bearer proof a staff principal presents after redeeming a grant. It is signed proof of "this
// principal redeemed this grant for this firm"; the live grant row (checked on every request) remains
// the source of truth for revocation and expiry. exp mirrors the grant's time-box.
export interface SupportSessionTokenPayload {
  readonly grantId: SupportGrantId;
  readonly principalId: PlatformStaffId;
  readonly firmId: FirmId;
  readonly requesterUserId: UserId;
  readonly tier: SupportGrantTier;
  readonly exp: number; // unix seconds
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

export async function mintSupportSessionToken(
  secret: string,
  payload: SupportSessionTokenPayload,
): Promise<string> {
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
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
  let payload: SupportSessionTokenPayload;
  try {
    payload = JSON.parse(decoder.decode(bytes)) as SupportSessionTokenPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < nowSeconds) return null;
  return payload;
}
