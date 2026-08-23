import { constantTimeStringEquals } from "../constant-time.ts";

// A first-party, Worker-signed delivery token — NOT an R2 presign. A presigned R2 GET signs only the
// host header and carries no Content-Disposition/nosniff/CSP, so it cannot frame untrusted bytes with
// the safe-delivery header set; inline-preview bytes must flow through the Worker under a token it
// signs and verifies itself. Signing with AUTH_SECRET (not a presigner adapter) means dev/test and
// production run the identical sign+verify path, so negative tests genuinely exercise rejection.
// Reasoning home: docs/conventions/security.md (untrusted file handling).
export interface PreviewTokenPayload {
  readonly r2Key: string;
  readonly bucket: string;
  readonly sniffedContentType: string;
  readonly verdict: "playable" | "download-only" | "indeterminate" | null;
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

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function signSegment(secret: string, segment: string): Promise<string> {
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(segment));
  return base64UrlEncode(signature);
}

export async function mintPreviewDeliveryToken(
  secret: string,
  payload: PreviewTokenPayload,
): Promise<string> {
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await signSegment(secret, body);
  return `${body}.${signature}`;
}

// Returns the verified payload, or null for ANY failure (format, signature, expiry). Never throws —
// the cookieless edge maps null to a bare 404 and must never surface a server-trace handle.
export async function verifyPreviewDeliveryToken(
  secret: string,
  token: string,
  nowSeconds: number,
): Promise<PreviewTokenPayload | null> {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const presentedSignature = token.slice(dot + 1);
  const recomputedSignature = await signSegment(secret, body);
  // Constant-time over the two base64url signature strings (each SHA-256-folded, fixed length).
  if (!(await constantTimeStringEquals(presentedSignature, recomputedSignature))) return null;
  const bytes = base64UrlDecodeToBytes(body);
  if (bytes === null) return null;
  let payload: PreviewTokenPayload;
  try {
    payload = JSON.parse(decoder.decode(bytes)) as PreviewTokenPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < nowSeconds) return null;
  return payload;
}
