/*
 * The protected-field read context, built once from a chokepoint-authenticated request.
 *
 * Every protected-field decrypt (packages/data-access/src/protected-fields.ts) needs the same five
 * things: the firm key handle, the per-firm database to write the decrypt audit into, the caller's
 * effective permissions (the gate), the acting user, and a clock. Three route modules assemble that
 * object by hand today — routes/directory.ts, routes/conflicts.ts and routes/matter-assets.ts — and
 * conflicts.ts says in its own comment that it mirrors directory.ts. This is the one shape they were
 * each copying.
 *
 * WHERE THE PERMISSION SET COMES FROM, AND WHY IT IS NOT RE-DERIVED. The chokepoint already resolves
 * the principal's effective permissions to run the route's primary gate and stashes them
 * (chokepoint.ts step 3b), precisely so a handler needing a second capability does not issue a second
 * load. The three hand-rolled copies predate that stash and each pay for an extra database round trip
 * per request. Reading the stash is also the more faithful answer: for a SUPPORT session the
 * chokepoint resolves the support tier's permissions rather than the member's roles
 * (chokepoint/ports.ts, makeLoadPermissions), so re-deriving from the member id would gate a support
 * principal on a permission set that support principal was never granted.
 *
 * The stash is populated only when the route names a permission. Every caller of this helper is a
 * permissioned route, and requireChokepointPermissions throws loudly rather than defaulting if that
 * ever stops being true — a decrypt gated on an empty set is a silent refusal, and a decrypt gated on
 * an absent one must never be a silent grant.
 */
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { ProtectedReadContext } from "@magna-carta/data-access/protected-fields";
import type { Bindings } from "./bindings.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointPermissions,
  requireChokepointUserId,
} from "./http/chokepoint/context-accessors.ts";
import { firmKeyProviderForEnv } from "./firm-key-provider-wiring.ts";
import type { AppVariables } from "./http/chokepoint/ports.ts";

// Declared structurally rather than as Hono's Context<E, P, I>, whose path/input generics differ per
// route: a fully-parameterized route handler context would not match a fixed Context type. Mirrors
// the same choice in chokepoint/context-accessors.ts, and adds `env` because the firm key provider is
// env-scoped.
export interface ProtectedReadContextSource {
  get<Key extends keyof AppVariables>(key: Key): AppVariables[Key];
  readonly env: Bindings;
}

// The only firm key version minted today. Named here rather than repeated at each call site so the
// day a second version exists has one place to change.
const FIRM_KEY_VERSION = 1;

export function protectedReadContext(source: ProtectedReadContextSource): ProtectedReadContext {
  const firm = requireChokepointFirmContext(source);
  return {
    firmId: requireChokepointFirmId(source),
    firmKeyVersion: FIRM_KEY_VERSION,
    firmKeyProvider: firmKeyProviderForEnv(source.env),
    database: firm.firmDatabase,
    effectivePermissions: requireChokepointPermissions(source),
    actorUserId: requireChokepointUserId(source),
    clock: { now: () => new Date().toISOString() },
    randomSource: cryptoRandomSource,
  };
}
