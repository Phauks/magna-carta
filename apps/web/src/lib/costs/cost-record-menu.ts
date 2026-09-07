/*
 * The cost ledger's row menu.
 *
 * ONE MENU, EXTENDED — NOT A SECOND ONE. The verbs every ledger shares (open, duplicate, copy a
 * value, the review chain, withdraw) come from the shared ledger catalogue, so the Costs tab cannot
 * drift from the Time tab about what a right-click offers or how a counted verb is worded. What is
 * added here is only what a cost has and a time entry does not: its attachments, its printable
 * sheet, and the delete a never-reviewed draft is entitled to.
 *
 * A COST THAT ENTERED REVIEW IS VOIDED, NEVER DELETED. A draft that never entered the chain has no
 * record to preserve, so deleting it outright is honest; anything that has been in review keeps its
 * entry on the books as evidence of what was withdrawn. Both verbs therefore appear, and which one
 * a row gets is decided by where it stands.
 */
import Paperclip from "@lucide/svelte/icons/paperclip";
import Receipt from "@lucide/svelte/icons/receipt";
import Printer from "@lucide/svelte/icons/printer";
import Trash2 from "@lucide/svelte/icons/trash-2";

// The specific modules rather than the catalogue's barrel: the barrel also exports the menu
// COMPONENT, and a pure model that reaches through it drags a whole component tree behind it.
import { ledgerRecordMenu, type LedgerRecord } from "$lib/records/ledger-record-menu.ts";
import {
  menuOf,
  oneRecordGesture,
  type NounPair,
  type RecordMenuAction,
  type RecordMenuItem,
  type RecordMenuModel,
} from "$lib/records/record-menu-model.ts";
import { gapReason } from "./cost-gaps.ts";

/** What this surface calls one of its records. */
export const COST_NOUN: NounPair = { singular: "Cost", plural: "Costs" };

/**
 * One cost row the menu speaks for.
 *
 * Beyond what the shared catalogue needs, a cost row names the bill that took it up. That is the
 * one fact a shared ledger record has no place for and the one the menu's own seam is built on.
 */
export interface CostMenuRecord extends LedgerRecord {
  /** The invoice that billed this cost, or null while nothing has. */
  readonly invoiceId?: string | null;
}

export interface CostMenuContext {
  /**
   * Whether the firm has review turned on. Off is the default, and off means the review vocabulary
   * does not appear at all: nothing on the row solicits a submission.
   */
  readonly reviewGateEnabled: boolean;
}

export function costRecordMenu(
  records: readonly CostMenuRecord[],
  target: CostMenuRecord,
  context: CostMenuContext,
): RecordMenuModel {
  const count = records.length;
  const shared = ledgerRecordMenu(records, target, {
    recordNoun: COST_NOUN,
    reviewGateEnabled: context.reviewGateEnabled,
  });
  const withdrawal = shared.find((group) => group.identifier === "destructive")?.items ?? [];

  return menuOf([
    ...shared
      .filter((group) => group.identifier !== "destructive")
      .map((group) => ({ identifier: group.identifier, items: [...group.items] })),
    { identifier: "costRecord", items: [openBillVerb(), attachVerb(), printVerb()] },
    { identifier: "destructive", items: [...withdrawal, deleteDraftVerb()] },
  ]);

  /*
   * The bill this cost reached, for the one question a ledger cannot answer about a billed row:
   * what was the client actually told?
   *
   * It is the seam back into Billing, and it renders on every cost rather than only on billed ones
   * — a verb that appears and disappears with a row's state teaches a reader the menu has a mind of
   * its own. A cost no invoice has taken up says so and stays put.
   */
  function openBillVerb(): RecordMenuAction {
    const billed = target.status === "billed";
    const invoiceId = target.invoiceId ?? null;
    return {
      kind: "action",
      identifier: "openBill",
      label: "Open The Bill",
      icon: Receipt,
      ...oneRecordGesture(count, "One cost's bill is opened at a time."),
      ...(billed && invoiceId !== null
        ? {}
        : {
            disabledReason: billed
              ? // Billed, but the listing did not carry which invoice. The claim is the truth about
                // who holds a cost and this is its mirror; a row that lost it is a read to fix,
                // never a bill to guess at.
                "This cost is billed, but the bill it reached was not read with it."
              : "Nothing has billed this cost yet. A draft bill claims it from the Billing section.",
          }),
    };
  }

  /*
   * The attachments. A receipt is the usual one, but a cost carries as many files as the spend
   * produced, so the verb is on the row rather than buried; what it waits on is a picker that
   * reaches the matter's own documents.
   */
  function attachVerb(): RecordMenuAction {
    return {
      kind: "action",
      identifier: "attach",
      label: "Attach File",
      icon: Paperclip,
      soonDependency: gapReason("attachmentPicker"),
      ...oneRecordGesture(count, "A file is attached to one cost at a time."),
    };
  }

  /* Every unit prints alone: a report combines costs and an invoice consolidates them, but one
     cost stands on its own sheet. */
  function printVerb(): RecordMenuAction {
    return {
      kind: "action",
      identifier: "print",
      label: "Print",
      icon: Printer,
      ...oneRecordGesture(count, "Printing takes one cost at a time."),
    };
  }

  function deleteDraftVerb(): RecordMenuItem | null {
    if (target.status !== "draft") return null;
    return {
      kind: "action",
      identifier: "deleteDraft",
      label: "Delete Draft",
      icon: Trash2,
      soonDependency: gapReason("deleteDraft"),
      ...oneRecordGesture(count, "A draft is deleted one at a time."),
    };
  }
}
