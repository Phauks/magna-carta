/*
 * The Connected Accounts page's writes, through the generated client's own functions. No path is
 * spelled here.
 */
import {
  connectedAccountsDisconnect,
  connectedAccountsStartMicrosoftSignIn,
} from "@magna-carta/api-client";

/** Where to send the browser to sign in at Microsoft, or undefined when that could not be started. */
export async function startOutlookSignIn(): Promise<string | undefined> {
  const { data } = await connectedAccountsStartMicrosoftSignIn();
  return data?.authorizationUrl;
}

/** Whether the account was disconnected. */
export async function disconnectAccount(id: string): Promise<boolean> {
  const { error } = await connectedAccountsDisconnect({ path: { id } });
  return error === undefined;
}
