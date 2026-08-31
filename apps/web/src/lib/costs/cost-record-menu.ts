/*
 * The cost ledger's row menu.
 *
 * ONE MENU, EXTENDED — NOT A SECOND ONE. The verbs every ledger shares (open, duplicate, copy a
 * value, the review chain, withdraw) come from the shared ledger catalogue, so the Costs tab cannot
 * drift from the Time tab about what a right-click offers or how a counted verb is worded. What is
 * added here is only what a cost has and a time entry does not: its receipt, its printable sheet,
 * and the delete a never-reviewed draft is entitled to.
 *
 * A COST THAT ENTERED REVIEW IS VOIDED, NEVER DELETED. A draft that never entered the chain has no
 * record to preserve, so deleting it outright is honest; anything that has been in review keeps its
 * entry on the books as evidence of what was withdrawn. Both verbs therefore appear, and which one
 * a row gets is decided by where it stands.
 */
import Paperclip from "@lucide/svelte/icons/paperclip";
import Printer from "@lucide/svelte/icons/printer";
import Trash2 from "@lucide/svelte/icons/trash-2";

import type { DisbursementClass } from "$lib/matters/cost-api.ts";
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
import { SOFT_COST_RECEIPT_NOTE } from "./cost-columns.ts";

/** What this surface calls one of its records. */
export const COST_NOUN: NounPair = { singular: "Cost", plural: "Costs" };

/** One cost row the menu speaks for. */
export interface CostMenuRecord extends LedgerRecord {
  /** A soft cost has no vendor invoice to keep, so its receipt verb is refused rather than waiting. */
  readonly disbursementClass: DisbursementClass;
}

export interface CostMenuContext {
  /**
   * Whether the firm has review turned on. The setting is not served, so the surface states what it
   * is assuming; the routes behind the chain verbs are the authority and refuse when it is off.
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
    { identifier: "costRecord", items: [receiptVerb(), printVerb()] },
    { identifier: "destructive", items: [...withdrawal, deleteDraftVerb()] },
  ]);

  /*
   * The receipt. The vendor invoice is the evidence a hard cost was actually advanced, so the verb
   * is on the row rather than buried; what it waits on is a picker that reaches the matter's files.
   */
  function receiptVerb(): RecordMenuAction {
    const soft = target.disbursementClass === "soft";
    return {
      kind: "action",
      identifier: "receipt",
      label: "Attach Receipt",
      icon: Paperclip,
      ...(soft
        ? { disabledReason: SOFT_COST_RECEIPT_NOTE }
        : { soonDependency: gapReason("receiptPicker") }),
      ...oneRecordGesture(count, "A receipt is attached to one cost at a time."),
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
