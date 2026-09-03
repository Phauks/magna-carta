/*
 * How the custody register's three sources read on the matter's Activity section. Each labels a
 * movement, a review or a return from a closed vocabulary; the item itself is behind the link.
 */
import Package from "@lucide/svelte/icons/package";
import PackageCheck from "@lucide/svelte/icons/package-check";
import ScanSearch from "@lucide/svelte/icons/scan-search";
import { navigateInto, type ActivityContribution } from "$lib/activity/contribution.ts";

export const custodyMovementActivityContribution: ActivityContribution = {
  sourceKey: "custodyMovement",
  section: "Custodian",
  noun: "Custody movement",
  happened: "An item in the firm's custody moved",
  icon: Package,
  labelMeaning: "Movement",
  types: ["Custody movement"],
  open: navigateInto,
};

export const custodyReviewDueActivityContribution: ActivityContribution = {
  sourceKey: "custodyReviewDue",
  section: "Custodian",
  noun: "Custody review",
  happened: "An item in custody is due for review",
  icon: ScanSearch,
  labelMeaning: "Review",
  types: ["Custody review"],
  open: navigateInto,
};

export const custodyDueBackActivityContribution: ActivityContribution = {
  sourceKey: "custodyDueBack",
  section: "Custodian",
  noun: "Custody return",
  happened: "An item checked out is due back",
  icon: PackageCheck,
  labelMeaning: "Return",
  types: ["Custody return"],
  open: navigateInto,
};
