import { assertPermission } from "@magna-carta/access-control/registry";
import { CALENDAR_SYNC_CATEGORY } from "@magna-carta/calendar/sync-port";
import {
  selectConnectionStatement,
  updateConnectionStatusStatement,
} from "@magna-carta/data-access/integration-connection-statements";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { FirmId, IntegrationConnectionId, UserId } from "@magna-carta/identifiers/types";
import { fetchHttpClient, type HttpClient } from "@magna-carta/integrations/http";
import type { Bindings } from "../bindings.ts";
import { firmDatabaseFor } from "../firm-database/firm-database-proxy.ts";
import { firmKeyProviderForEnv } from "../firm-key-provider-wiring.ts";
import {
  integrationCredentialStoreForFirm,
  type CredentialStoreForFirm,
} from "../plugins/credential-store.ts";
import { providerEditApplier } from "./apply-provider-edit.ts";
import { NO_REQUEST_ORIGIN, resolveApplicationOfAdapter } from "./calendar-providers.ts";
import { keepWatch, newWatchSecret, watchAddressFor, type WatchState } from "./change-watch.ts";
import { openMemberCalendarPort } from "./member-calendars.ts";
import { memberCalendarCredentialStore } from "./member-credential-store.ts";
import { runOutboundPass, type OutboundPassReport } from "./outbound-pass.ts";
import { requestCalendarSync } from "./request-sync.ts";
import { readShownCalendars } from "./shown-calendars.ts";

// One connected account's pass, with everything it needs found from the deployment and the firm's
// own database. The object that schedules passes (connection-sync.ts) calls this and decides only
// when to call it next.

export interface ConnectionIdentity {
  readonly firmId: FirmId;
  readonly connectionId: IntegrationConnectionId;
  readonly memberUserId: UserId;
}

export type ConnectionPassOutcome =
  // `watch` is the provider's change watch as the account should remember it after this pass.
  | {
      readonly kind: "settled" | "more" | "unavailable";
      readonly report: OutboundPassReport;
      readonly watch: WatchState | null;
    }
  // The provider refused the sign-in. The connection is marked, so the member is told on their
  // Connected Accounts page, and nothing runs until they sign in again.
  | { readonly kind: "sign-in-again" }
  // This deployment is not registered with the account's provider, or the account is not in a
  // state to be written to. Nothing to do and nothing to retry.
  | { readonly kind: "dormant" }
  // The connection no longer exists: the member disconnected.
  | { readonly kind: "gone" };

export interface ConnectionPassOverrides {
  readonly http?: HttpClient;
  readonly now?: () => Date;
  readonly credentialStoreForFirm?: CredentialStoreForFirm;
  readonly newWatchSecret?: () => string;
}

interface ConnectionRow {
  readonly id: string;
  readonly adapter_id: string;
  readonly credential_ref: string;
  readonly status: string;
}

export async function runConnectionPass(
  env: Bindings,
  identity: ConnectionIdentity,
  overrides: ConnectionPassOverrides = {},
  // The watch the account remembers from its last pass.
  watch: WatchState | null = null,
): Promise<ConnectionPassOutcome> {
  const now = overrides.now ?? (() => new Date());
  const http = overrides.http ?? fetchHttpClient();
  const database = firmDatabaseFor(env.FIRM_DATABASE, identity.firmId);
  const connection = await selectConnectionStatement(
    database,
    CALENDAR_SYNC_CATEGORY,
    identity.memberUserId,
  ).first<ConnectionRow>();
  // A member who disconnected and connected again holds a new connection with a new object of its
  // own; this one's account is gone.
  if (connection === null || connection.id !== identity.connectionId) return { kind: "gone" };
  if (connection.status !== "connected") return { kind: "dormant" };
  const application = resolveApplicationOfAdapter(env, NO_REQUEST_ORIGIN, connection.adapter_id);
  if (application === undefined) return { kind: "dormant" };

  const markSignInAgain = async (): Promise<ConnectionPassOutcome> => {
    await updateConnectionStatusStatement(
      database,
      identity.connectionId,
      "needs_reauth",
      now().toISOString(),
    ).run();
    return { kind: "sign-in-again" };
  };

  // The pass acts as the member whose account this is, and the decrypt is audited against them.
  // The store it is handed opens that member's own calendar sign-in and refuses any other
  // reference (member-credential-store.ts), so the one permission named here cannot reach a
  // credential of the firm's.
  const opened = await openMemberCalendarPort({
    http,
    now,
    application,
    credentials: memberCalendarCredentialStore(
      {
        firmId: identity.firmId,
        // The only firm key version minted today.
        firmKeyVersion: 1,
        firmKeyProvider: firmKeyProviderForEnv(env),
        database,
        effectivePermissions: new Set([assertPermission("integrations:useConnection")]),
        actorUserId: identity.memberUserId,
        clock: { now: () => now().toISOString() },
        randomSource: cryptoRandomSource,
      },
      identity.memberUserId,
      overrides.credentialStoreForFirm ?? integrationCredentialStoreForFirm,
    ),
    credentialRef: connection.credential_ref,
  });
  if (opened.kind === "sign-in-again") return markSignInAgain();
  if (opened.kind === "unavailable") {
    return {
      kind: "unavailable",
      report: {
        created: 0,
        updated: 0,
        removed: 0,
        refused: 0,
        applied: 0,
        flagged: 0,
        putBack: 0,
      },
      watch,
    };
  }

  const outcome = await runOutboundPass({
    database,
    connectionId: identity.connectionId,
    memberUserId: identity.memberUserId,
    port: opened.port,
    now,
    newTransactionId: () => crypto.randomUUID(),
    applyProviderEdit: providerEditApplier({
      database,
      memberUserId: identity.memberUserId,
      provider: application.provider,
      now,
    }),
    // An edit carried back changes an event other members may have copies of. Asking is all that
    // is needed: each account's own pass finds the difference.
    onEventsChanged: () => requestCalendarSync(env, identity.firmId, database),
  });
  if (outcome.kind === "sign-in-again") return markSignInAgain();
  // A provider that could not be reached for the pass is not asked about the watch either.
  if (outcome.kind === "unavailable") return { ...outcome, watch };
  // The other direction: the member's own events, from the calendars they chose to be shown. A
  // provider that falters here costs nothing already read, and the next pass asks again.
  const shown = await readShownCalendars({
    database,
    connectionId: identity.connectionId,
    port: opened.port,
    now,
  });
  if (shown.kind === "sign-in-again") return markSignInAgain();
  return {
    ...outcome,
    watch: await keepWatch({
      port: opened.port,
      current: watch,
      address: watchAddressFor(env, identity, application.provider),
      now,
      newSecret: overrides.newWatchSecret ?? newWatchSecret,
    }),
  };
}
