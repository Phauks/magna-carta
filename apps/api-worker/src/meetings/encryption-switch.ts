import type { Bindings } from "../bindings.ts";

/**
 * WHETHER THIS DEPLOYMENT OPENS MEETINGS END-TO-END ENCRYPTED.
 *
 * Encryption is the product's default for every new meeting, but it waits on this switch until the
 * browsers' frame transform has been run against the live routing service in every browser the firm
 * uses: a meeting whose pictures nobody can open is worse than one in the clear. Off, every meeting
 * opens in the clear exactly as before; on, every way of opening one (Start, a scheduled meeting, a
 * personal room) opens it sealed unless the request asks otherwise.
 *
 * One function, so the three opening paths cannot disagree about what the deployment does.
 */
export function endToEndEncryptionEnabled(
  env: Pick<Bindings, "MEETINGS_END_TO_END_ENCRYPTION">,
): boolean {
  return env.MEETINGS_END_TO_END_ENCRYPTION === "on";
}
