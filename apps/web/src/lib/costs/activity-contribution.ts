/*
 * How a cost reads on the matter's Activity section — its description names what was bought, and
 * the amount is the fact anybody scanning wants.
 */
import Receipt from "@lucide/svelte/icons/receipt";
import {
  factNumber,
  factText,
  navigateInto,
  type ActivityContribution,
  type Fact,
} from "$lib/activity/contribution.ts";
import { ledgerStatusWord } from "$lib/records/ledger-status-word.ts";

export const costEntryActivityContribution: ActivityContribution = {
  sourceKey: "costEntry",
  section: "Costs",
  noun: "Cost",
  happened: "A cost was recorded",
  icon: Receipt,
  labelMeaning: "Cost",
  types: ["Cost"],
  factsOf: (row, context) => {
    const result: Fact[] = [];
    const amountMinor = factNumber(row.facts, "amountMinor");
    const currency = factText(row.facts, "currency");
    if (amountMinor !== null && currency !== null) {
      result.push({ value: context.money(amountMinor, currency) });
    }
    if (factNumber(row.facts, "billable") === 0) result.push({ value: "Non-billable" });
    const status = ledgerStatusWord(factText(row.facts, "status"));
    if (status !== undefined) result.push({ value: status });
    return result;
  },
  open: navigateInto,
};
