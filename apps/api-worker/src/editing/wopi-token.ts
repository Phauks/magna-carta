// Short-lived, HMAC-signed capability token for the WOPI editing surface. Collabora replays this
// token (an opaque `access_token` query parameter) on every callback, with no session cookie, so the
// host authenticates the call from the token alone. The signing key is derived PER FIRM from
// AUTH_SECRET: a leaked derived key is scoped to one firm rather than the whole platform, and the
// `kid` (key version) in the header is the rotation seam. The MAC is verified constant-time and
// BEFORE any claim is trusted — a request that re-points the token at another firm derives the wrong
// key and fails the MAC. The token value never appears in any log or error message (the error carries
// only a stable code).

import { constantTimeStringEquals } from "../constant-time.ts";

export type EditCapability = "view" | "edit";

// What the editor-launch route supplies. `exp` is an absolute epoch-millisecond expiry (the caller
// computes "now + the token window"); `jti` is generated at mint.
export interface MintEditTokenInput {
  firmId: string;
  matterId: string;
  fileId: string;
  versionId: string;
  memberId: string;
  capability: EditCapability;
  sessionId: string;
  exp: number;
  // The origin of the app page that launched this session — the firm's own branded subdomain, which
  // differs per firm and is therefore known only at launch. CheckFileInfo hands it back as
  // PostMessageOrigin, which is the origin the editor addresses its status messages to; without it the
  // editor loads and says nothing, and the screen framing it cannot tell a cold container from a
  // refused frame. Optional because a token minted before this claim existed is still inside its hour:
  // it simply carries no origin, and the editor stays silent for the rest of that session.
  appOrigin?: string;
}

// The verified claim set handed to a WOPI callback handler.
export interface EditTokenClaims extends MintEditTokenInput {
  jti: string;
}

export type WopiTokenErrorCode = "malformed" | "bad-signature" | "expired";

export class WopiTokenError extends Error {
  readonly code: WopiTokenErrorCode;
  constructor(code: WopiTokenErrorCode, message?: string) {
    super(message ?? code);
    this.name = "WopiTokenError";
    this.code = code;
  }
}

// Current signing-key version. Bumping it rotates the key for newly-minted tokens while existing
// tokens keep verifying under their own `kid` — a graceful dual-read rotation, never a flag day.
const KEY_VERSION = "1";
const ALGORITHM = "HS256";
// Tolerance for clock skew between the minting and verifying isolates (the tokens carry absolute time).
const DEFAULT_CLOCK_SKEW_MS = 30_000;
// Fixed public HKDF salt — domain-separates this derivation from any other use of AUTH_SECRET.
const HKDF_SALT = new TextEncoder().encode("magna-carta-wopi-token-v1");

interface TokenHeader {
  alg: string;
  kid: string;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function base64urlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesFromBase64url(value: string): Uint8Array {
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

const base64urlFromString = (value: string): string =>
  base64urlFromBytes(textEncoder.encode(value));
const stringFromBase64url = (value: string): string =>
  textDecoder.decode(bytesFromBase64url(value));

// Derives the per-firm HMAC-SHA-256 signing key from AUTH_SECRET. The HKDF info binds the key to the
// firm and the key version, so a key recovered for one firm cannot verify another firm's tokens.
async function deriveFirmSigningKey(
  authSecret: string,
  firmId: string,
  keyVersion: string,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(authSecret),
    { name: "HKDF" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: HKDF_SALT,
      info: textEncoder.encode(`mc:wopi-token:v${keyVersion}:${firmId}`),
    },
    baseKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function computeMac(signingInput: string, key: CryptoKey): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(signingInput));
  return base64urlFromBytes(new Uint8Array(signature));
}

export async function mintEditToken(
  input: MintEditTokenInput,
  env: { AUTH_SECRET: string },
): Promise<string> {
  const header: TokenHeader = { alg: ALGORITHM, kid: KEY_VERSION };
  const jti = base64urlFromBytes(crypto.getRandomValues(new Uint8Array(12)));
  const claims: EditTokenClaims = { ...input, jti };

  const signingInput = `${base64urlFromString(JSON.stringify(header))}.${base64urlFromString(
    JSON.stringify(claims),
  )}`;
  const key = await deriveFirmSigningKey(env.AUTH_SECRET, input.firmId, KEY_VERSION);
  const mac = await computeMac(signingInput, key);
  return `${signingInput}.${mac}`;
}

export async function verifyEditToken(
  token: string,
  env: { AUTH_SECRET: string },
  options: { now?: number; clockSkewMs?: number } = {},
): Promise<EditTokenClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new WopiTokenError("malformed");
  const [encodedHeader, encodedClaims, presentedMac] = parts as [string, string, string];

  // Decode the header + claims only to SELECT the verification key (kid + firmId). Nothing here is
  // trusted until the MAC verifies below — a tampered firmId simply selects a key the MAC won't match.
  let header: TokenHeader;
  let claims: EditTokenClaims;
  try {
    header = JSON.parse(stringFromBase64url(encodedHeader)) as TokenHeader;
    claims = JSON.parse(stringFromBase64url(encodedClaims)) as EditTokenClaims;
  } catch {
    throw new WopiTokenError("malformed");
  }
  if (typeof header?.kid !== "string" || typeof claims?.firmId !== "string") {
    throw new WopiTokenError("malformed");
  }

  const key = await deriveFirmSigningKey(env.AUTH_SECRET, claims.firmId, header.kid);
  const expectedMac = await computeMac(`${encodedHeader}.${encodedClaims}`, key);
  if (!(await constantTimeStringEquals(expectedMac, presentedMac))) {
    throw new WopiTokenError("bad-signature");
  }

  // The signature is valid; the claims may now be trusted. Validate the shape and the expiry.
  if (claims.capability !== "view" && claims.capability !== "edit") {
    throw new WopiTokenError("malformed");
  }
  if (typeof claims.exp !== "number") throw new WopiTokenError("malformed");
  const now = options.now ?? Date.now();
  const clockSkewMs = options.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS;
  if (now > claims.exp + clockSkewMs) throw new WopiTokenError("expired");

  return claims;
}
