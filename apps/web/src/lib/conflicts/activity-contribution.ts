/*
 * How a conflicts check reads on the matter's Activity section. The matter's own Conflicts section
 * owns the source, so a row opens into the check it names — navigateInto reads that ownership off
 * the section registry rather than hard-coding a route here.
 */
import CircleDot from "@lucide/svelte/icons/circle-dot";
import { navigateInto, type ActivityContribution } from "$lib/activity/contribution.ts";

export const conflictsCheckActivityContribution: ActivityContribution = {
  sourceKey: "conflictsCheck",
  section: "Conflicts",
  noun: "Conflicts check",
  happened: "A conflicts check was run",
  icon: CircleDot,
  labelMeaning: "Outcome",
  types: ["Conflicts check"],
  open: navigateInto,
};
