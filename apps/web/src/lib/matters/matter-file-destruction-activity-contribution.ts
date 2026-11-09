/*
 * How the date the firm's own paper file may be destroyed reads on the matter's Activity section.
 * One source, one sentence: the date is a reminder the firm recorded, and the row says so rather
 * than suggesting that anything happens to the file when it arrives.
 */
import ArchiveX from "@lucide/svelte/icons/archive-x";
import { navigateInto, type ActivityContribution } from "$lib/activity/contribution.ts";

export const matterFileDestructionActivityContribution: ActivityContribution = {
  sourceKey: "matterFileDestruction",
  section: "Matter",
  noun: "File destruction date",
  happened: "The paper file may be destroyed from this date",
  icon: ArchiveX,
  types: ["File destruction date"],
  open: navigateInto,
};
