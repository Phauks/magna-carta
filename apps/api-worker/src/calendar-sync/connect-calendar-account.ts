import { CALENDAR_SYNC_CATEGORY } from "@magna-carta/calendar/sync-port";
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import {
  selectConnectionStatement,
  upsertConnectionStatement,
} from "@magna-carta/data-access/integration-connection-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { IntegrationConnectionId, UserId } from "@magna-carta/identifiers/types";
import type { CredentialStore } from "@magna-carta/integrations/credentials";
import type { HttpClient } from "@magna-carta/integrations/http";
import type { CalendarProviderApplication } from "./calendar-providers.ts";

// Turning the code a provider handed a member's browser into a recorded connection. Called only
// after the return has been matched to a sign-in this browser started; nothing here checks that.

// Where a member's calendar token is addressed. A member has at most one calendar connection, so
// the ref is derived from the member rather than minted: signing in again overwrites the old token
// in place instead of leaving it sealed under a reference nothing points at.
export function calendarCredentialRefForMember(userId: UserId): string {
  return `integration:${CALENDAR_SYNC_CATEGORY}:${userId}`;
}

export interface ConnectCalendarAccountInput {
  readonly http: HttpClient;
  readonly now: () => Date;
  readonly application: CalendarProviderApplication;
  readonly code: string;
  readonly codeVerifier: string;
  readonly userId: UserId;
  readonly firmDatabase: BatchDatabase;
  readonly credentials: CredentialStore;
}

// `other-account` is a member who already has an account connected at a different provider. A
// member holds one calendar connection, and every copy on record is in the account it names;
// pointing the same connection at another provider would leave those records naming events that
// are not there. They disconnect the first account and then connect the second.
export type ConnectCalendarAccountOutcome = "connected" | "declined" | "failed" | "other-account";

export async function connectCalendarAccount(
  input: ConnectCalendarAccountInput,
): Promise<ConnectCalendarAccountOutcome> {
  const { http, now, userId, firmDatabase, application } = input;
  const existing = await selectConnectionStatement(
    firmDatabase,
    CALENDAR_SYNC_CATEGORY,
    userId,
  ).first<{ id: string; adapter_id: string }>();
  // Before the code is spent: nothing is asked of the provider for a sign-in that cannot be kept.
  if (existing !== null && existing.adapter_id !== application.adapterId) return "other-account";

  const redeemed = await application.redeem(
    { http, now },
    { code: input.code, codeVerifier: input.codeVerifier },
  );
  if (!redeemed.ok) return "failed";
  // A provider lets a member or an administrator grant less than was asked. An account whose
  // calendar was withheld is not a calendar connection, and recording it as one would leave a
  // member wondering why nothing ever arrives.
  if (redeemed.grantedScopes.length > 0 && !application.grantsCalendar(redeemed.grantedScopes)) {
    return "declined";
  }

  const adapter = application.adapter({ http, now });
  const [account, calendars] = await Promise.all([
    application.readAccount(http, redeemed.credential.accessToken),
    // Read once now, with the token just issued, so "connected" means the calendar can actually be
    // reached and not merely that a sign-in completed.
    adapter.create({ credential: redeemed.credential }).listCalendars(),
  ]);
  if (!account.ok || !calendars.ok) return "failed";

  const connectionId =
    existing === null
      ? newIdentifier("integrationConnection")
      : (existing.id as IntegrationConnectionId);
  const credentialRef = calendarCredentialRefForMember(userId);
  // The token first, then the row that points at it. A row over a token that was never stored
  // would tell the member they are connected when nothing can act for them; a stored token with no
  // row is inert, and the next sign-in overwrites it. Only the refresh token is kept: the access
  // token lasts about an hour and is asked for again when it is needed.
  // fitness:allow-no-dimensions — not a bucket write: this seals a credential into the per-firm
  // integration_credential table, and nothing reaches object storage.
  await input.credentials.put(credentialRef, {
    kind: "oauth",
    refreshToken: redeemed.credential.refreshToken,
  });
  const instant = now().toISOString();
  await commitEffectBatch(
    firmDatabase,
    {
      statements: [
        upsertConnectionStatement(firmDatabase, {
          id: connectionId,
          category: CALENDAR_SYNC_CATEGORY,
          adapterId: application.adapterId,
          scope: "user",
          principalRef: userId,
          credentialRef,
          capabilitySnapshot: JSON.stringify(adapter.descriptor),
          createdAt: instant,
          accountLabel: account.address,
        }),
        domainAuditStatement(firmDatabase, {
          event: "calendar_sync.account_connected",
          subjectId: connectionId,
          actorUserId: userId,
          clock: { now: () => instant },
          // Which provider, and never which account: the address is the member's own and the
          // connection row already holds it.
          metadata: { provider: application.provider },
        }),
      ],
      outboxMessages: [],
    },
    { now: () => instant },
  );
  return "connected";
}
