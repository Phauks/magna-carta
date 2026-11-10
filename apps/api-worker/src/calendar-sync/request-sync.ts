import {
  selectSyncingConnectionsStatement,
  type SyncingConnectionRow,
} from "@magna-carta/calendar/sync-link-statements";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../bindings.ts";
import { resolveMicrosoftApplication } from "./microsoft-application.ts";

// Something that a member's calendar could depend on has changed in this firm: ask every account
// with a rule, or with a copy still out, to look again.
//
// Every account and not only the ones the change concerns, on purpose. Working out who a change
// concerns means reading the event, its participants and its matter's assignments at the moment of
// every write, and being wrong about it means a hearing that silently stays where it was in
// somebody's calendar. Asking costs each account one read of its own window, the request is folded
// into whatever pass that account already has waiting, and a pass that finds no difference sends
// the provider nothing.
//
// A deployment with no Microsoft application has no account to ask and returns before reading.
export async function requestCalendarSync(
  env: Bindings,
  firmId: FirmId,
  database: SqlDatabase,
): Promise<void> {
  if (resolveMicrosoftApplication(env, "https://no-request.invalid") === undefined) return;
  const { results } = await selectSyncingConnectionsStatement(database).all<SyncingConnectionRow>();
  await Promise.all(
    results.map((connection) =>
      env.CONNECTION_SYNC.get(
        env.CONNECTION_SYNC.idFromName(`${firmId}:${connection.id}`),
      ).requestPass({
        firmId,
        connectionId: connection.id,
        memberUserId: connection.principal_ref,
      }),
    ),
  );
}
