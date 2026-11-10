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
import {
  createMicrosoftCalendarAdapter,
  MICROSOFT_CALENDAR_ADAPTER_ID,
} from "@magna-carta/microsoft-graph/calendar-sync";
import {
  readSignedInAccount,
  redeemAuthorizationCode,
  type MicrosoftApplication,
} from "@magna-carta/microsoft-graph/sign-in";

// Turning the code Microsoft handed a member's browser into a recorded connection. Called only
// after the return has been matched to a sign-in this browser started; nothing here checks that.

// Where a member's calendar token is addressed. A member has at most one calendar connection, so
// the ref is derived from the member rather than minted: signing in again overwrites the old token
// in place instead of leaving it sealed under a reference nothing points at.
export function calendarCredentialRefForMember(userId: UserId): string {
  return `integration:${CALENDAR_SYNC_CATEGORY}:${userId}`;
}

// Microsoft names a granted permission either bare or as a full address under the Graph origin,
// and in whatever letter case it likes.
function grantsCalendar(grantedScopes: readonly string[]): boolean {
  return grantedScopes.some((scope) => {
    const name = scope.slice(scope.lastIndexOf("/") + 1).toLowerCase();
    return name === "calendars.readwrite";
  });
}

export interface ConnectMicrosoftAccountInput {
  readonly http: HttpClient;
  readonly now: () => Date;
  readonly application: MicrosoftApplication;
  readonly code: string;
  readonly codeVerifier: string;
  readonly userId: UserId;
  readonly firmDatabase: BatchDatabase;
  readonly credentials: CredentialStore;
}

export async function connectMicrosoftAccount(
  input: ConnectMicrosoftAccountInput,
): Promise<"connected" | "declined" | "failed"> {
  const { http, now, userId, firmDatabase } = input;
  const redeemed = await redeemAuthorizationCode({ http, now }, input.application, {
    code: input.code,
    codeVerifier: input.codeVerifier,
  });
  if (!redeemed.ok) return "failed";
  // Microsoft lets a member or an administrator grant less than was asked. An account whose
  // calendar was withheld is not a calendar connection, and recording it as one would leave a
  // member wondering why nothing ever arrives.
  if (redeemed.grantedScopes.length > 0 && !grantsCalendar(redeemed.grantedScopes)) {
    return "declined";
  }

  const adapter = createMicrosoftCalendarAdapter({ http });
  const [account, calendars] = await Promise.all([
    readSignedInAccount(http, redeemed.credential.accessToken),
    // Read once now, with the token just issued, so "connected" means the calendar can actually be
    // reached and not merely that a sign-in completed.
    adapter.create({ credential: redeemed.credential }).listCalendars(),
  ]);
  if (!account.ok || !calendars.ok) return "failed";

  const existing = await selectConnectionStatement(
    firmDatabase,
    CALENDAR_SYNC_CATEGORY,
    userId,
  ).first<{ id: string }>();
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
          adapterId: MICROSOFT_CALENDAR_ADAPTER_ID,
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
          metadata: { provider: "microsoft" },
        }),
      ],
      outboxMessages: [],
    },
    { now: () => instant },
  );
  return "connected";
}
