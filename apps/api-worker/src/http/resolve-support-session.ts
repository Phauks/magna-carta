import type { Context } from "hono";
import { isIdentifier } from "@magna-carta/identifiers/validate";
import {
  selectPlatformStaffStatement,
  selectSupportGrantStatement,
  type PlatformStaffRow,
  type SupportGrantRow,
} from "@magna-carta/data-access/support-access-statements";
import type { Bindings } from "../bindings.ts";
import type { SessionContext } from "./session-context.ts";
import { supportGrantUsable } from "../support/grant-lifecycle.ts";
import { verifySupportSessionToken } from "../support/support-session-token.ts";

// Resolve a support-session principal from the X-Support-Session header, or null. The token is only the
// bearer proof; the live grant row is the source of truth — firm, requester, and tier come from the row
// (defense in depth), and a revoked/expired grant fails supportGrantUsable so access dies immediately.
export async function resolveSupportSession(
  env: Bindings,
  c: Context,
  nowSeconds: number,
): Promise<SessionContext | null> {
  const header = c.req.header("X-Support-Session");
  if (header === undefined || header === "") return null;
  const payload = await verifySupportSessionToken(env.AUTH_SECRET, header, nowSeconds);
  if (payload === null) return null;

  // Guard the grantId from the token before binding it in a DB query (the token deserializes from
  // JSON so the type annotation is not a runtime guarantee; a malformed value must return null, not
  // reach the DB).
  if (!isIdentifier(payload.grantId, "supportGrant")) return null;
  const result = await selectSupportGrantStatement(
    env.DB_CONTROL,
    payload.grantId,
  ).all<SupportGrantRow>();
  const grant = result.results[0];
  if (grant === undefined) return null;
  const nowIso = new Date(nowSeconds * 1000).toISOString();
  if (!supportGrantUsable(grant, nowIso)) return null;
  // Guard malformed principal IDs before the staff DB round-trip (runtime defense — the token
  // deserializes from JSON so the type annotation alone is not a runtime guarantee).
  if (!isIdentifier(payload.principalId, "platformStaff")) return null;
  // Re-verify the staff principal is still active on every request so a disabled account loses
  // access immediately, even with a live token and an unexpired grant.
  const staffRows = await selectPlatformStaffStatement(
    env.DB_CONTROL,
    payload.principalId,
  ).all<PlatformStaffRow>();
  const staff = staffRows.results[0];
  if (!staff || staff.status !== "active") return null;

  // Guard all three grant-row identifiers before building the session context. assertIdentifier
  // would throw on a malformed value, breaking the "never throws" contract — isIdentifier returns
  // a boolean so a corrupt DB value returns null instead of propagating as an uncaught 500.
  if (
    !isIdentifier(grant.requested_by_user_id, "user") ||
    !isIdentifier(grant.firm_id, "firm") ||
    !isIdentifier(grant.id, "supportGrant")
  ) {
    return null;
  }
  return {
    userId: grant.requested_by_user_id,
    firmId: grant.firm_id,
    support: {
      grantId: grant.id,
      principalId: payload.principalId,
      tier: grant.tier,
    },
  };
}
