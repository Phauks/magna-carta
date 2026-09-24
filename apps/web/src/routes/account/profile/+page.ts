/*
 * The Profile screen's reads, started where the hover preload can reach them.
 *
 * The session bootstrap is what this page states the account's address from and what the picture's
 * fallback initials come from. Warmed at the session-stable ceiling — the same ceiling the (app)
 * layout uses — so moving between the account pages does not re-ask a question whose answer changes
 * when an administrator changes it.
 *
 * The name and the picture are deliberately NOT warmed here. Both are read by the plates that own
 * them and both are written back by those plates from the same call, so warming them would put a
 * second holder of each answer beside the one already responsible for keeping it current. They move
 * here the day they are read by something other than their own plate.
 */
import { meGetOptions } from "@magna-carta/api-client";
import { warmSessionStable } from "$lib/api/screen-data.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = () => {
  warmSessionStable(meGetOptions());
};
