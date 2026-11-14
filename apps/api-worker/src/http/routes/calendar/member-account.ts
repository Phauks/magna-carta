import { CALENDAR_SYNC_CATEGORY } from "@magna-carta/calendar/sync-port";
import { readSyncRules, readSyncSubjects } from "@magna-carta/calendar/sync-rule-service";
import { readShownCalendars } from "@magna-carta/calendar/sync-shown-service";
import {
  selectConnectionStatement,
  updateConnectionStatusStatement,
} from "@magna-carta/data-access/integration-connection-statements";
import type { IntegrationConnectionId } from "@magna-carta/identifiers/types";
import type { HttpClient } from "@magna-carta/integrations/http";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import {
  listMemberCalendars,
  type MemberCalendarsOutcome,
} from "../../../calendar-sync/member-calendars.ts";
import { memberCalendarCredentialStore } from "../../../calendar-sync/member-credential-store.ts";
import {
  calendarProviderOfAdapter,
  resolveApplicationOfAdapter,
} from "../../../calendar-sync/calendar-providers.ts";
import type { CredentialStoreForFirm } from "../../../plugins/credential-store.ts";
import { protectedReadContext } from "../../../protected-read-context.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";

// The session member's own calendar account, for the settings routes that read or change what is
// done with it. Found through their own principal and nothing a request names, which is the whole
// of why one member can never read or change another's.

export type MemberAccountContext = Context<{ Bindings: Bindings; Variables: AppVariables }>;

export interface MemberAccountRow {
  readonly id: string;
  readonly adapter_id: string;
  readonly credential_ref: string;
  readonly status: "connected" | "degraded" | "needs_reauth" | "disabled";
  readonly account_label: string | null;
  readonly created_at: string;
}

export interface MemberAccountPorts {
  readonly http: HttpClient;
  readonly credentialStoreForFirm: CredentialStoreForFirm;
  readonly now: () => Date;
}

export async function memberAccount(c: MemberAccountContext): Promise<MemberAccountRow | null> {
  const row = await selectConnectionStatement(
    requireChokepointFirmContext(c).firmDatabase,
    CALENDAR_SYNC_CATEGORY,
    requireChokepointUserId(c),
  ).first<MemberAccountRow>();
  return row !== null && calendarProviderOfAdapter(row.adapter_id) !== undefined ? row : null;
}

// The account's calendars as the provider lists them at this moment.
export async function memberAccountCalendars(
  c: MemberAccountContext,
  connection: MemberAccountRow,
  ports: MemberAccountPorts,
): Promise<MemberCalendarsOutcome> {
  const application = resolveApplicationOfAdapter(c.env, c.req.url, connection.adapter_id);
  if (application === undefined) return { kind: "unavailable" };
  const outcome = await listMemberCalendars({
    http: ports.http,
    now: ports.now,
    application,
    credentials: memberCalendarCredentialStore(
      protectedReadContext(c),
      requireChokepointUserId(c),
      ports.credentialStoreForFirm,
    ),
    credentialRef: connection.credential_ref,
  });
  // The provider said the account must be signed in to again. Recorded, so the Connected
  // Accounts page says so the next time it is opened, whichever page found out.
  if (outcome.kind === "sign-in-again" && connection.status !== "needs_reauth") {
    await updateConnectionStatusStatement(
      requireChokepointFirmContext(c).firmDatabase,
      connection.id as IntegrationConnectionId,
      "needs_reauth",
      ports.now().toISOString(),
    ).run();
  }
  return outcome;
}

// The member's whole calendar sync settings, as every route that reads or changes them answers.
export async function memberSyncSettings(
  c: MemberAccountContext,
  connection: MemberAccountRow | null,
  calendars: MemberCalendarsOutcome | null,
) {
  const database = requireChokepointFirmContext(c).firmDatabase;
  const [subjects, rules, shownCalendars] = await Promise.all([
    readSyncSubjects(database),
    connection === null
      ? Promise.resolve([])
      : readSyncRules(database, connection.id as IntegrationConnectionId),
    connection === null
      ? Promise.resolve([])
      : readShownCalendars(database, connection.id as IntegrationConnectionId),
  ]);
  return {
    account:
      connection === null
        ? null
        : {
            id: connection.id,
            provider: calendarProviderOfAdapter(connection.adapter_id) ?? ("microsoft" as const),
            accountLabel: connection.account_label,
            status:
              calendars?.kind === "sign-in-again" ? ("needs_reauth" as const) : connection.status,
            connectedAt: connection.created_at,
          },
    calendars: calendars?.kind === "listed" ? [...calendars.calendars] : null,
    subjects,
    rules,
    shownCalendars,
  };
}
