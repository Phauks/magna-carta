/*
 * Whether Google and Microsoft accept this deployment's own application, as the System Status page
 * reports it beside the other outside services. A feature whose two settings are present is only
 * "set up"; this is what tells a working registration from a mistyped secret, before a member finds
 * out by failing to connect.
 *
 * The check carries no member's account and issues no token: it is a refresh request with a
 * refresh token that was never issued, and the provider's refusal says whether it recognised the
 * application (packages/integrations/src/oauth-sign-in.ts).
 */
import { checkApplicationCredentials as checkGoogle } from "@magna-carta/google-calendar/sign-in";
import type { HttpClient } from "@magna-carta/integrations/http";
import type { ApplicationCredentialCheck } from "@magna-carta/integrations/oauth-sign-in";
import { checkApplicationCredentials as checkMicrosoft } from "@magna-carta/microsoft-graph/sign-in";
import type { Bindings } from "../bindings.ts";
import type { ConnectedServiceStatusReport } from "../meetings/sfu/realtime-status.ts";
import { NO_REQUEST_ORIGIN } from "./calendar-providers.ts";
import { resolveGoogleApplication } from "./google-application.ts";
import { resolveMicrosoftApplication } from "./microsoft-application.ts";

export type CalendarProviderStatusBindings = Partial<
  Pick<
    Bindings,
    | "MICROSOFT_CLIENT_ID"
    | "MICROSOFT_CLIENT_SECRET"
    | "MICROSOFT_TENANT"
    | "GOOGLE_CALENDAR_CLIENT_ID"
    | "GOOGLE_CALENDAR_CLIENT_SECRET"
    | "APP_BASE_URL"
  >
>;

type CalendarServiceId = "googleCalendar" | "microsoftCalendar";

const STATE_OF_CHECK: Readonly<
  Record<ApplicationCredentialCheck, ConnectedServiceStatusReport["state"]>
> = {
  accepted: "connected",
  refused: "refused",
  unreachable: "unreachable",
};

async function probe(
  id: CalendarServiceId,
  check: (() => Promise<ApplicationCredentialCheck>) | undefined,
  timeoutMilliseconds: number,
): Promise<ConnectedServiceStatusReport> {
  if (check === undefined) return { id, state: "not-configured", latencyMilliseconds: null };
  const startedAtEpochMilliseconds = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outOfTime = new Promise<ApplicationCredentialCheck>((resolve) => {
    timer = setTimeout(() => resolve("unreachable"), timeoutMilliseconds);
  });
  try {
    const answer = await Promise.race([check(), outOfTime]);
    return {
      id,
      state: STATE_OF_CHECK[answer],
      latencyMilliseconds: Date.now() - startedAtEpochMilliseconds,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** One row per calendar provider, each asked at the same time under its own time limit. */
export function probeCalendarProviders(
  env: CalendarProviderStatusBindings,
  http: HttpClient,
  timeoutMilliseconds: number,
): Promise<ConnectedServiceStatusReport[]> {
  // The redirect address is never sent by the check, so no request's origin is needed.
  const google = resolveGoogleApplication(env, NO_REQUEST_ORIGIN);
  const microsoft = resolveMicrosoftApplication(env, NO_REQUEST_ORIGIN);
  return Promise.all([
    probe(
      "googleCalendar",
      google === undefined ? undefined : () => checkGoogle(http, google),
      timeoutMilliseconds,
    ),
    probe(
      "microsoftCalendar",
      microsoft === undefined ? undefined : () => checkMicrosoft(http, microsoft),
      timeoutMilliseconds,
    ),
  ]);
}
