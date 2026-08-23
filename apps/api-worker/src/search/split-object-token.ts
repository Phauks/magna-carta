import { corpusSplitPrefix } from "@magna-carta/search/split";
import type { CorpusScope } from "@magna-carta/search/corpus";
import { constantTimeStringEquals } from "../constant-time.ts";

// The capability token the search engine presents on every split-object read and write.
//
// The engine runs in a Container with no R2 credentials and no egress; it reaches a firm's split
// objects only by calling the split-object host in this Worker (split-object-host.ts), forwarded there
// by the search worker's container outbound interception. That forwarding hop carries no trust of its
// own, exactly as the WOPI callback hop does not (apps/api-worker/src/editing/wopi-guard.ts) — so the host
// reconstructs firm scope from this token alone, on every single range read.
//
// A token is a capability over ONE CORPUS, never over a bucket. The claims carry the firm and the
// corpus; the allowed key prefix is DERIVED from the corpus (@magna-carta/search/split), never carried,
// so a tampered prefix is not expressible and a token minted for one corpus cannot name another's
// splits even though the object keys sit in the same bucket. The request line chooses which split
// inside that prefix — a query reads the several splits the catalog named, so the key cannot come from
// the token the way a WOPI file id does; constraining it to the token's own prefix is what keeps the
// choice inside the firm's own corpus.
//
// Signed with AUTH_SECRET so mint and verify are the identical path in tests and in production. The
// window is short because the token's whole life is one engine operation.

export interface SplitObjectTokenClaims {
  readonly firmId: string;
  readonly corpusKind: CorpusScope["kind"];
  readonly corpusId: string;
  // Whether the holder may write. A query is read-only; only `index` and `compact` publish an object,
  // and handing a query a token that can overwrite a split would make a read path a write path.
  readonly write: boolean;
  // Absolute epoch-millisecond expiry.
  readonly exp: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Domain-separates this derivation from every other use of AUTH_SECRET.
const HKDF_SALT = encoder.encode("magna-carta-split-object-token-v1");
const KEY_VERSION = "1";

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

// The per-firm HMAC key. The HKDF info binds it to the firm and the key version, so a key recovered for
// one firm verifies nothing for another — the same rotation seam the editing token uses.
async function deriveFirmSigningKey(authSecret: string, firmId: string): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(authSecret),
    { name: "HKDF" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: HKDF_SALT,
      info: encoder.encode(`mc:split-object-token:v${KEY_VERSION}:${firmId}`),
    },
    baseKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function computeMac(signingInput: string, key: CryptoKey): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));
  return base64UrlEncode(signature);
}

export async function mintSplitObjectToken(
  claims: SplitObjectTokenClaims,
  env: { AUTH_SECRET: string },
): Promise<string> {
  const body = base64UrlEncode(encoder.encode(JSON.stringify(claims)));
  const key = await deriveFirmSigningKey(env.AUTH_SECRET, claims.firmId);
  return `${body}.${await computeMac(body, key)}`;
}

// Returns the verified claims, or null for ANY failure — malformed, forged, or expired. Never throws
// and never distinguishes the three to the caller: the host answers every one of them the same way, so
// a caller probing the surface learns nothing from which rejection it got.
export async function verifySplitObjectToken(
  token: string,
  env: { AUTH_SECRET: string },
  nowMilliseconds: number,
): Promise<SplitObjectTokenClaims | null> {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const presentedMac = token.slice(dot + 1);

  // Decode only to SELECT the verification key. Nothing here is trusted until the MAC verifies: a
  // tampered firmId derives a different key and the MAC simply fails to match.
  const bytes = base64UrlDecodeToBytes(body);
  if (bytes === null) return null;
  let claims: SplitObjectTokenClaims;
  try {
    claims = JSON.parse(decoder.decode(bytes)) as SplitObjectTokenClaims;
  } catch {
    return null;
  }
  if (typeof claims?.firmId !== "string" || claims.firmId === "") return null;

  const key = await deriveFirmSigningKey(env.AUTH_SECRET, claims.firmId);
  if (!(await constantTimeStringEquals(await computeMac(body, key), presentedMac))) return null;

  // The signature holds; the claims may now be trusted. Validate the shape before anything reads them.
  // The closed kind vocabulary, checked rather than trusted: the signature says the claims are ours,
  // and this says they are a shape we understand. A kind we do not recognise would derive a prefix
  // from `corpusSplitPrefix` anyway — the prefix needs only the id — so an unchecked kind would
  // authorize a key without anybody having decided what corpus it belongs to.
  if (claims.corpusKind !== "matter" && claims.corpusKind !== "reviewSet") return null;
  if (typeof claims.corpusId !== "string" || claims.corpusId === "") return null;
  if (typeof claims.write !== "boolean") return null;
  if (typeof claims.exp !== "number" || nowMilliseconds > claims.exp) return null;
  return claims;
}

// The one key prefix a token authorizes, derived from its corpus. Every request the host serves is
// checked against this and nothing else.
export function authorizedSplitPrefix(claims: SplitObjectTokenClaims): string {
  return corpusSplitPrefix({ kind: claims.corpusKind, id: claims.corpusId } as CorpusScope);
}
