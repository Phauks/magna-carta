// The route-specific guard for the token-authenticated WOPI surface. Collabora replays an opaque
// access_token on every callback with no session cookie, so this surface authenticates from the
// token alone — not through the cookie chokepoint. Tenancy holds because the guard derives the firm
// (and the handler the file) SOLELY from the verified token: there is no request-path input here, so
// a token presented against another firm's WOPISrc cannot reach that firm's data — the firm database
// is keyed by the token's firmId, and the handler then looks the token's fileId up in THAT database.

import { verifyEditToken, WopiTokenError, type EditTokenClaims } from "./wopi-token.ts";

export type WopiGuardErrorCode = "unauthorized" | "not-found" | "forbidden-readonly";

export class WopiGuardError extends Error {
  readonly code: WopiGuardErrorCode;
  constructor(code: WopiGuardErrorCode, message?: string) {
    super(message ?? code);
    this.name = "WopiGuardError";
    this.code = code;
  }
}

// Resolves a firm's per-firm database from the firmId carried in the verified token. The wiring
// composes the control-plane `database_identifier` lookup with resolveFirmDatabase; null is a firm
// with no live database (unknown / unprovisioned / key-shredded), which the guard answers as 404.
export type FirmDatabaseResolver = (firmId: string) => Promise<D1Database | null>;

export interface WopiGuardResult {
  readonly claims: EditTokenClaims;
  readonly firmDatabase: D1Database;
}

// Authenticates a WOPI callback. Throws WopiGuardError("unauthorized") for a bad/expired token and
// WopiGuardError("not-found") for a firm with no live database; the caller maps these to the WOPI
// status. Firm scope is reconstructed only from the verified token, never from the request line.
export async function wopiGuard(
  token: string,
  env: { AUTH_SECRET: string },
  resolveFirmDatabase: FirmDatabaseResolver,
): Promise<WopiGuardResult> {
  let claims: EditTokenClaims;
  try {
    claims = await verifyEditToken(token, env);
  } catch (error) {
    if (error instanceof WopiTokenError) throw new WopiGuardError("unauthorized", error.code);
    throw error;
  }

  const firmDatabase = await resolveFirmDatabase(claims.firmId);
  if (firmDatabase === null) throw new WopiGuardError("not-found");

  return { claims, firmDatabase };
}

// Server-side capability enforcement for write/lock callbacks. CheckFileInfo's UserCanWrite is only
// a UI hint; the access token is the gate, so a view-capability token mutates nothing.
export function assertEditCapability(claims: EditTokenClaims): void {
  if (claims.capability !== "edit") throw new WopiGuardError("forbidden-readonly");
}
