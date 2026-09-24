import { constantTimeStringEquals } from "./constant-time.ts";

// THE ONE BEARER-TOKEN FORMAT THIS WORKER SIGNS: `base64url(payload).base64url(HMAC-SHA-256(secret,
// body))`, with a `typ` discriminator inside the payload.
//
// ONE FORMAT, SEVERAL TOKEN KINDS, ONE SECRET — which is exactly why `typ` is load-bearing rather than
// decoration. A support-session token, a preview-file token and a meeting guest's two credentials are
// all signed with `AUTH_SECRET` in this shape, so without the discriminator any one of them would pass
// another's signature check. Verification refuses a token whose `typ` is not the one the caller asked
// for, and minting always stamps it, so a caller can neither omit it nor set it wrong.
//
// The signature is compared in constant time over the two base64url strings (each SHA-256-folded
// first, so length cannot leak either), and every failure — shape, signature, parse, type — answers
// the same null. A caller maps null to one flat refusal and never to anything that says which check
// failed.

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
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
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

/** Signs a payload in the shared format, stamping its `typ`. */
export async function mintSignedToken(
  secret: string,
  typ: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<string> {
  const body = base64UrlEncode(encoder.encode(JSON.stringify({ ...payload, typ })));
  return `${body}.${await signSegment(secret, body)}`;
}

/**
 * The payload of a token whose signature verifies AND whose `typ` is the one asked for, or null.
 *
 * Expiry is the caller's, because each kind carries it differently; this answers only "did this
 * worker sign this, as this kind of token". Never throws.
 */
export async function verifySignedToken(
  secret: string,
  token: string,
  typ: string,
): Promise<Record<string, unknown> | null> {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const presentedSignature = token.slice(dot + 1);
  const recomputedSignature = await signSegment(secret, body);
  if (!(await constantTimeStringEquals(presentedSignature, recomputedSignature))) return null;
  const bytes = base64UrlDecodeToBytes(body);
  if (bytes === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  return record["typ"] === typ ? record : null;
}
