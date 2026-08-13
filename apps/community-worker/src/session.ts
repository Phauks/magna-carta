// Who is asking, resolved from the control-plane database and nothing else.
//
// A session on this platform is a row in the control-plane `session` table with a high-entropy
// token, and this worker binds that database. So resolving a caller is a lookup of the presented
// token against the stored one, joined to the account for the firm it belongs to. That check is
// stronger than verifying the cookie's signature, because it also proves the session exists and has
// not expired — a forged signature over a token nobody issued matches no row.
//
// WHAT THIS WORKER DELIBERATELY DOES NOT DO. It does not construct an authentication library, it
// does not issue, refresh or revoke a session, and it does not read any account field beyond the
// three it needs. Signing in happens on the application worker; this one only recognises the result.
//
// A NOTE ON HOW THE TOKEN ARRIVES, which is a deployment question rather than a code one. The
// platform's session cookie is host-only by deliberate design — a parent-domain cookie would be
// sent to every firm's branded subdomain and to the cookieless content host — so a cookie set by
// the application's host is not sent to this worker's host. Reads are unaffected, because reading
// the board needs no session at all. Writes need the token to arrive, and the resolver below takes
// it from either the cookie or an `Authorization: Bearer` header for exactly that reason: the
// header is what a same-origin handoff or a first-party fetch from the application can supply
// without weakening the cookie's scope.

import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import type { SqlDatabase } from "@magna-carta/community/sql";
import type { Context } from "hono";

export interface BoardSession {
  readonly userId: UserId;
  readonly firmId: FirmId;
  // True when this account joined the platform as a firm's CLIENT rather than as somebody who works
  // there. A client of a firm must never write on this board, and the failure being prevented is
  // specific and severe: a post signed with a real name, from an account that exists only because
  // one firm invited its client, discloses that firm-client relationship to every reader.
  //
  // This is a CHECK, and it should not stay one. The intended shape is that a portal principal is
  // structurally incapable of holding a board identity — a distinct principal type on the account,
  // or portal clients not sharing the `user` table at all — because a check is one refactor away
  // from being silently wrong and this particular failure is a confidentiality breach rather than a
  // bug. Today the redemption path writes the same `user` row for both invitation kinds and records
  // the difference only on the invitation, so the invitation is the only place the distinction
  // exists to be read. When the account gains a principal type of its own, this reads that instead
  // and the join below goes away.
  readonly isPortalPrincipal: boolean;
  // The account's own name, used only as the SUGGESTED display name when a member first writes.
  // It is never stored on a post and never rendered from here: the board's display name lives on
  // the community profile, which is a separate record precisely so the two can differ.
  readonly accountName: string;
  readonly emailVerified: boolean;
}

// The port. Injected so the routes can be exercised without standing up an authentication flow, and
// so the one place that knows how a caller is recognised is this file.
export interface SessionPort {
  resolve(c: Context): Promise<BoardSession | null>;
}

// Better Auth prefixes its cookie (`better-auth.` plus `__Secure-` over https), so the name is
// matched by suffix — the same way the application worker's own tests match it.
const SESSION_COOKIE_SUFFIX = "session_token";

export function sessionTokenFromRequest(c: Context): string | null {
  const authorization = c.req.header("authorization");
  if (authorization !== undefined && authorization.toLowerCase().startsWith("bearer ")) {
    const presented = authorization.slice("bearer ".length).trim();
    if (presented !== "") return presented.split(".")[0] ?? null;
  }
  const cookieHeader = c.req.header("cookie");
  if (cookieHeader === undefined) return null;
  for (const pair of cookieHeader.split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    const name = pair.slice(0, separator).trim();
    if (!name.endsWith(SESSION_COOKIE_SUFFIX)) continue;
    const value = decodeURIComponent(pair.slice(separator + 1).trim());
    // The cookie carries `<token>.<signature>`. The token alone is what the session row is keyed
    // by, and matching the row is what proves the session — see the note at the top of this file.
    const token = value.split(".")[0];
    return token === undefined || token === "" ? null : token;
  }
  return null;
}

interface SessionLookupRow {
  readonly user_id: string;
  readonly expires_at: number;
  readonly name: string;
  readonly email_verified: number;
  readonly firm_id: string;
  readonly firm_status: string;
  readonly portal_invitation_count: number;
}

export function controlPlaneSessionPort(database: SqlDatabase, now: () => number): SessionPort {
  return {
    async resolve(c: Context): Promise<BoardSession | null> {
      const token = sessionTokenFromRequest(c);
      if (token === null) return null;
      const row = await database
        .prepare(
          // The firm's own status is joined in because writing requires a PROVISIONED firm. That
          // requirement is the highest-value anti-spam control the board has and it is already
          // built: a spammer has to complete email verification, the human check, and the whole
          // registration flow before posting once.
          `SELECT s.user_id AS user_id, s.expires_at AS expires_at,
                  u.name AS name, u.email_verified AS email_verified,
                  u.firm_id AS firm_id, f.status AS firm_status,
                  (SELECT COUNT(*) FROM invitation AS i
                     WHERE i.redeemed_user_id = s.user_id AND i.kind = 'clientOfFirm')
                    AS portal_invitation_count
             FROM session AS s
             JOIN user AS u ON u.id = s.user_id
             JOIN firm AS f ON f.id = u.firm_id
            WHERE s.token = ?1`,
        )
        .bind(token)
        .first<SessionLookupRow>();
      if (row === null) return null;
      if (row.expires_at <= now()) return null;
      if (row.firm_status !== "active") return null;
      return {
        userId: row.user_id as UserId,
        firmId: row.firm_id as FirmId,
        accountName: row.name,
        emailVerified: row.email_verified !== 0,
        isPortalPrincipal: row.portal_invitation_count > 0,
      };
    },
  };
}
