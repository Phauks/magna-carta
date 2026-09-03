/*
 * How an email saved to the matter reads on the Activity section.
 *
 * AWAITING ITS OWNER. The Emails section is a stub and there is no email code in the web app yet, so
 * this contribution waits here; it moves beside that code the day the section is built, and the
 * registry entry in ../contributions.ts is the only line that changes. The source declares no label
 * — a subject line is privileged — so a row says an email was saved, when, and by whom.
 */
import Mail from "@lucide/svelte/icons/mail";
import { navigateInto, type ActivityContribution } from "$lib/activity/contribution.ts";

export const emailActivityContribution: ActivityContribution = {
  sourceKey: "emailFiled",
  section: "Emails",
  noun: "Email",
  // Saved, not filed: nothing was filed with a court.
  happened: "An email was saved to the matter",
  icon: Mail,
  types: ["Email"],
  open: navigateInto,
};
