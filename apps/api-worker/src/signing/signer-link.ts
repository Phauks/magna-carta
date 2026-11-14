import type { FirmId, SigningRequestId, SigningSignerId } from "@magna-carta/identifiers/types";
import { isIdentifier } from "@magna-carta/identifiers/validate";
import { mintSignedToken, verifySignedToken } from "../signed-token.ts";

// AN OUTSIDE SIGNER'S LINK, on the one signed-token format this worker uses (../signed-token.ts),
// with its own `typ`, so it is never a meeting guest's link nor anything else.
//
// The token names the firm, the request, the signer and the version of the signer's secret, and
// carries the secret itself. The signer's row keeps only the secret's SHA-256 and the version, so a
// correction that bumps the version stops every older link at once, and the database alone cannot
// make a working link.
//
// THE SECRET IS DERIVED, NOT STORED. It is an HMAC of the signer and the version under the
// deployment's key, so a reminder mails the same link the first mail carried rather than replacing
// it: a signer who opens the first email still lands on the request. Without the key nothing can
// derive it, and the stored hash still lets the row refuse a link whose version it no longer holds.
//
// WHY A SIGNATURE AS WELL AS A STORED HASH: the signature turns a guessed or mangled token away with
// no database read, and the row turns away a link that was corrected, cancelled or declined at once.
//
// NEITHER THE TOKEN NOR THE SECRET IS EVER LOGGED, counted, echoed in a problem or written to an
// activity line.

/** The `typ` of the link a signer's email carries. */
export const SIGNER_LINK_TOKEN_TYPE = "signing-request-signer";

/** The header a signer's page sends the link in. Never the address: an address is logged. */
export const SIGNER_LINK_HEADER = "x-signing-link";

/** Where the signer's page lives on the application's own origin, outside the signed-in shell. */
export const SIGNER_SCREEN_PATH = "/sign";

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(key: string, message: string): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return await crypto.subtle.sign("HMAC", imported, encoder.encode(message));
}

/** The signer's secret at a version: 256 bits, derived under the deployment's key. */
export async function signerLinkSecret(
  key: string,
  firmId: FirmId,
  signerId: SigningSignerId,
  secretVersion: number,
): Promise<string> {
  return base64Url(
    await hmac(key, `signing-link\u0000${firmId}\u0000${signerId}\u0000${secretVersion}`),
  );
}

/** What the signer's row stores: the SHA-256 of the secret, lowercase hex. */
export async function hashSignerSecret(secret: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(secret)));
}

/**
 * The six digits mailed to a signer who proves who they are with a code, stored only as this keyed
 * digest: a stolen copy of the row cannot be turned back into the digits by trying the million of
 * them, because the key is the deployment's and not the row's.
 */
export async function hashAccessCode(
  key: string,
  signerId: SigningSignerId,
  digits: string,
): Promise<string> {
  return hex(await hmac(key, `signing-access-code\u0000${signerId}\u0000${digits}`));
}

/** Six digits from the platform's random source, leading zeros kept. */
export function newAccessCode(): string {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  return String(value % 1_000_000).padStart(6, "0");
}

export interface SignerLinkFacts {
  readonly firmId: FirmId;
  readonly requestId: SigningRequestId;
  readonly signerId: SigningSignerId;
  readonly secretVersion: number;
}

/** Mint the link for a signer; it lives until the request's own expiry. */
export async function mintSignerLink(
  key: string,
  facts: SignerLinkFacts & { readonly expiresAt: string },
): Promise<string> {
  return await mintSignedToken(key, SIGNER_LINK_TOKEN_TYPE, {
    firmId: facts.firmId,
    requestId: facts.requestId,
    signerId: facts.signerId,
    secretVersion: facts.secretVersion,
    exp: Math.floor(Date.parse(facts.expiresAt) / 1000),
    secret: await signerLinkSecret(key, facts.firmId, facts.signerId, facts.secretVersion),
  });
}

/** The signer's page for one link, on the origin the request that sent it arrived at. */
export function signerPageLink(origin: string, token: string): string {
  return `${origin}${SIGNER_SCREEN_PATH}/${encodeURIComponent(token)}`;
}

/**
 * What a presented link says, or null for every way it is not one: a bad shape, a signature this
 * worker did not make, another kind of token, or a payload that does not name what it must. A link
 * whose own expiry has passed is `expired`, because only somebody the firm sent it to can present a
 * signed one, and they are owed a sentence they can act on.
 */
export async function readSignerLink(
  key: string,
  presented: string,
  nowSeconds: number,
): Promise<{
  readonly outcome: "verified" | "expired";
  readonly link: SignerLinkFacts & { readonly secret: string };
} | null> {
  const payload = await verifySignedToken(key, presented, SIGNER_LINK_TOKEN_TYPE);
  if (payload === null) return null;
  const { firmId, requestId, signerId, secretVersion, exp, secret } = payload;
  if (
    !isIdentifier(firmId, "firm") ||
    !isIdentifier(requestId, "signingRequest") ||
    !isIdentifier(signerId, "signingSigner") ||
    typeof secretVersion !== "number" ||
    !Number.isInteger(secretVersion) ||
    typeof exp !== "number" ||
    typeof secret !== "string" ||
    secret === ""
  ) {
    return null;
  }
  return {
    outcome: exp <= nowSeconds ? "expired" : "verified",
    link: { firmId, requestId, signerId, secretVersion, secret },
  };
}
