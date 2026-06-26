import type { Context } from "hono";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import {
  selectSupportGrantStatement,
  type SupportGrantRow,
} from "@magna-carta/data-access/support-access-statements";
import type { Bindings } from "../app.ts";
import type { SessionContext } from "../session-context.ts";
import { supportGrantUsable } from "./grant-lifecycle.ts";
import { verifySupportSessionToken } from "./support-session-token.ts";

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

  const result = await selectSupportGrantStatement(env.DB_CONTROL, payload.grantId).all<SupportGrantRow>();
  const grant = result.results[0];
  if (grant === undefined) return null;
  const nowIso = new Date(nowSeconds * 1000).toISOString();
  if (!supportGrantUsable(grant, nowIso)) return null;

  return {
    userId: assertIdentifier(grant.requested_by_user_id, "user"),
    firmId: assertIdentifier(grant.firm_id, "firm"),
    support: {
      grantId: assertIdentifier(grant.id, "supportGrant"),
      principalId: assertIdentifier(payload.principalId, "platformStaff"),
      tier: grant.tier,
    },
  };
}
