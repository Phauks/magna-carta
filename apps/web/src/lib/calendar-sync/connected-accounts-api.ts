/*
 * The Connected Accounts page's writes, through the generated client's own functions. No path is
 * spelled here.
 */
import {
  connectedAccountsDisconnect,
  connectedAccountsStartGoogleSignIn,
  connectedAccountsStartMicrosoftSignIn,
} from "@magna-carta/api-client";
import type { CalendarProvider } from "./connected-accounts.ts";

/** Where to send the browser to sign in at the provider, or undefined when that could not be started. */
export async function startCalendarSignIn(provider: CalendarProvider): Promise<string | undefined> {
  const { data } =
    provider === "google"
      ? await connectedAccountsStartGoogleSignIn()
      : await connectedAccountsStartMicrosoftSignIn();
  return data?.authorizationUrl;
}

/** Whether the account was disconnected. */
export async function disconnectAccount(id: string): Promise<boolean> {
  const { error } = await connectedAccountsDisconnect({ path: { id } });
  return error === undefined;
}
