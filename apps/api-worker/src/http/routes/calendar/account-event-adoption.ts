import type { CalendarProvider } from "@magna-carta/calendar/sync-contract";
import { insertAdoptedSyncLinkStatement } from "@magna-carta/calendar/sync-link-statements";
import {
  deleteExternalEventStatement,
  selectExternalEventCalendarStatement,
} from "@magna-carta/calendar/sync-shown-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { IntegrationConnectionId } from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import { problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { memberAccount, type MemberAccountContext } from "./member-account.ts";

// A new matter event made from one of the session member's own Outlook or Google events: the member's
// event is kept and becomes the new event's synced copy, so they never see two. The create route
// calls the two halves inside its idempotent effect and answers the refusal below.

/** The event named as the one a new event is made from is not among the member's own. */
export class AccountEventNotFound extends Error {}

type Database = Parameters<typeof insertAdoptedSyncLinkStatement>[0];

export interface AccountEventToAdopt {
  readonly connectionId: IntegrationConnectionId;
  readonly calendarRemoteId: string;
  readonly remoteEventId: string;
}

/**
 * The member's own event, found through their own account and nothing else: an identifier that is
 * not one of theirs, as a pass last read them, throws `AccountEventNotFound`. Called inside the
 * effect and not ahead of the idempotency gate, because the first attempt removes the row and a
 * replay of it must still answer what the first did.
 */
export async function findAccountEventToAdopt(
  c: MemberAccountContext,
  database: Database,
  named: { readonly provider: CalendarProvider; readonly id: string },
): Promise<AccountEventToAdopt> {
  const account = await memberAccount(c, named.provider);
  if (account === null) throw new AccountEventNotFound();
  const connectionId = account.id as IntegrationConnectionId;
  const row = await selectExternalEventCalendarStatement(database, connectionId, named.id).first<{
    calendar_remote_id: string;
  }>();
  if (row === null) throw new AccountEventNotFound();
  return { connectionId, calendarRemoteId: row.calendar_remote_id, remoteEventId: named.id };
}

/**
 * In the same batch as the event: the member's own event becomes this event's copy and stops being
 * listed as theirs alone, so no pass ever sees the event without its link and writes a second copy
 * beside the first.
 */
export function adoptAccountEventWrite(
  database: Database,
  adopted: AccountEventToAdopt,
  matterEventId: string,
): EffectWrite {
  return {
    statements: [
      insertAdoptedSyncLinkStatement(
        database,
        { connectionId: adopted.connectionId, localKind: "matter_event", localId: matterEventId },
        {
          calendarRemoteId: adopted.calendarRemoteId,
          remoteEventId: adopted.remoteEventId,
          transactionId: crypto.randomUUID(),
        },
        new Date().toISOString(),
      ),
      deleteExternalEventStatement(
        database,
        adopted.connectionId,
        adopted.remoteEventId,
        adopted.calendarRemoteId,
      ),
    ],
    outboxMessages: [],
  };
}

export function accountEventNotFoundProblem(c: Context): ProblemResponse<404> {
  return problemJson(c, {
    type: "not-found",
    title: "That event is not in your calendar",
    status: 404,
    detail:
      "The event was not found among the ones read from your own calendar. It may have " +
      "been deleted or moved there since this screen last read it.",
  });
}
