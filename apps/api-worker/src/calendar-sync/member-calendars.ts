import type { CalendarSyncPort, ProviderCalendar } from "@magna-carta/calendar/sync-port";
import type { CredentialStore } from "@magna-carta/integrations/credentials";
import type { HttpClient } from "@magna-carta/integrations/http";
import { createMicrosoftCalendarAdapter } from "@magna-carta/microsoft-graph/calendar-sync";
import {
  refreshAccessToken,
  type MicrosoftApplication,
} from "@magna-carta/microsoft-graph/sign-in";

// A connected member's calendars, as their provider lists them at this moment.
//
// The stored token is the long-lived one only, so every call here first trades it for a short-lived
// access token. Microsoft may answer that trade with a replacement long-lived token; when it does,
// the replacement is stored before anything else happens, so the newest token is always the one
// held.

export type MemberCalendarsOutcome =
  | { readonly kind: "listed"; readonly calendars: readonly ProviderCalendar[] }
  // The account has to be signed in to again: the token was revoked, expired from disuse, or an
  // administrator at the provider changed what is allowed.
  | { readonly kind: "sign-in-again" }
  // Anything that may pass by itself: the provider is unreachable, slow, or limiting requests.
  | { readonly kind: "unavailable" };

export interface MemberCalendarsInput {
  readonly http: HttpClient;
  readonly now: () => Date;
  readonly application: MicrosoftApplication;
  readonly credentials: CredentialStore;
  readonly credentialRef: string;
}

export type MemberCalendarPortOutcome =
  | { readonly kind: "open"; readonly port: CalendarSyncPort }
  | { readonly kind: "sign-in-again" }
  | { readonly kind: "unavailable" };

// The member's calendar account, opened for one piece of work. Everything that acts on a member's
// calendar comes through here, so the trade of the stored token for a working one, and the storing
// of a replacement, are written once.
export async function openMemberCalendarPort(
  input: MemberCalendarsInput,
): Promise<MemberCalendarPortOutcome> {
  const stored = await input.credentials.get(input.credentialRef);
  // A connection whose token is gone cannot act for anybody; signing in again stores a new one.
  if (stored === null || stored.kind !== "oauth") return { kind: "sign-in-again" };

  const refreshed = await refreshAccessToken(
    { http: input.http, now: input.now },
    input.application,
    stored.refreshToken,
  );
  if (!refreshed.ok) {
    return { kind: refreshed.problem.category === "auth" ? "sign-in-again" : "unavailable" };
  }
  if (refreshed.credential.refreshToken !== stored.refreshToken) {
    // fitness:allow-no-dimensions — not a bucket write: this seals a credential into the per-firm
    // integration_credential table, and nothing reaches object storage.
    await input.credentials.put(input.credentialRef, {
      kind: "oauth",
      refreshToken: refreshed.credential.refreshToken,
    });
  }
  return {
    kind: "open",
    port: createMicrosoftCalendarAdapter({ http: input.http }).create({
      credential: refreshed.credential,
    }),
  };
}

export async function listMemberCalendars(
  input: MemberCalendarsInput,
): Promise<MemberCalendarsOutcome> {
  const opened = await openMemberCalendarPort(input);
  if (opened.kind !== "open") return opened;
  const listed = await opened.port.listCalendars();
  if (!listed.ok) {
    return { kind: listed.problem?.category === "auth" ? "sign-in-again" : "unavailable" };
  }
  return { kind: "listed", calendars: listed.value };
}
