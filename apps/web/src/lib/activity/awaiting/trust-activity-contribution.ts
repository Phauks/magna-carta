/*
 * How a trust movement reads on the matter's Activity section.
 *
 * AWAITING ITS OWNER. The Trust section is a stub and there is no trust code in the web app yet, so
 * this contribution waits here and moves beside that code the day the section is built.
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
