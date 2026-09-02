/*
 * How an assembled document reads on the matter's Activity section. The source labels the run's
 * outcome and the count of fields the matter had no value for; neither is the document's contents.
 */
import FileStack from "@lucide/svelte/icons/file-stack";
import { navigateInto, type ActivityContribution } from "$lib/activity/contribution.ts";

export const documentAssemblyActivityContribution: ActivityContribution = {
  sourceKey: "documentAssembly",
  section: "Files",
  noun: "Assembled document",
  happened: "A document was assembled from a template",
  icon: FileStack,
  labelMeaning: "Outcome",
  types: ["Assembled document"],
  open: navigateInto,
};
