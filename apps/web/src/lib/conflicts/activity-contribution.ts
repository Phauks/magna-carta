/*
 * How a conflicts check reads on the matter's Activity section. No matter section owns a check yet,
 * so a row states what happened and offers nowhere to go — the section registry says why.
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
