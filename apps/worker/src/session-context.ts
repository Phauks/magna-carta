import type { Context } from "hono";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import type { createAuth } from "./auth.ts";

export interface SessionContext {
  readonly userId: UserId;
  readonly firmId: FirmId;
}

// The first link of the ADR-0067 chokepoint chain (API contract spec, chokepoint order step 1):
// session cookie → Better Auth control-plane lookup → { userId, firmId }. The firm comes from the
// session, never the URL (ADR-0052). This slice it is a plain function handlers call — the full
// ordered middleware (RBAC per route metadata, rate limits) is slice 0·5. Null means no valid
// session; the caller answers with the RFC 9457 401 problem.
export async function resolveSession(
  auth: ReturnType<typeof createAuth>,
  c: Context,
): Promise<SessionContext | null> {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (session === null) return null;
  // The handles are asserted, not cast: a session row carrying a malformed id is corruption and
  // must fail loud, never flow onward as a branded identifier.
  return {
    userId: assertIdentifier(session.user.id, "user"),
    firmId: assertIdentifier(session.user.firmId, "firm"),
  };
}
