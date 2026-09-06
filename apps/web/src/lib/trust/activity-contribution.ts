/*
 * How a trust movement reads on the matter's Activity section: the kind leads, because whether
 * client money came in, went out or moved between two matters is the only thing worth leading a
 * row with, and the row opens into the Trust section's own ledger, where the movement's method,
 * counterparty, recorder and authorizer are read in full.
 *
 * It lives beside the Trust section's own web code, as every contribution lives beside the
 * subsystem that owns its rows; it waited under $lib/activity/awaiting while the section was a
 * stub and moved here the day the section gained its ledger.
 */
import Banknote from "@lucide/svelte/icons/banknote";
import { navigateInto, type ActivityContribution } from "$lib/activity/contribution.ts";

export const trustMovementActivityContribution: ActivityContribution = {
  sourceKey: "trustMovement",
  section: "Trust",
  noun: "Trust movement",
  happened: "Client money moved",
  icon: Banknote,
  labelMeaning: "Movement",
  types: ["Trust movement"],
  open: navigateInto,
};
