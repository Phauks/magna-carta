/*
 * The verbs of the ledger surfaces: time, fees and costs.
 *
 * Same menu, different words. The rules about counting, scoping and refusing are the ones every
 * surface shares; what is particular here is three things the file surfaces have no equivalent of.
 *
 * DUPLICATE AND COPY ARE TWO DIFFERENT ANSWERS. Right-clicking an entry and choosing "Copy" used to
 * mean whichever of them the reader assumed. They are now separate: "Duplicate" is a verb that
 * starts a new draft from this entry's fields, and "Copy" is a flyout of the VALUES worth putting
 * on the clipboard — the entry number, the description, the amount. Neither one is a guess about
 * the other.
 *
 * THE APPROVAL CHAIN IS QUIET, AND OPTIONAL. A firm that has not turned review on does not have a
 * review vocabulary at all: submitting and approving are ABSENT rather than present and refused,
 * because a disabled "Submit" solicits a workflow the firm has declined. Where review is on, the
 * chain verbs live here in the row menu rather than as headline buttons.
 *
 * WITHDRAWING IS DONE ONE AT A TIME. Voiding is the one irreversible-feeling act on these surfaces,
 * and the deliberate judgment is that it is not a bulk gesture. It stays on screen over a selection
 * and says so, rather than vanishing.
 */
import ArrowRightLeft from "@lucide/svelte/icons/arrow-right-left";
import CircleSlash from "@lucide/svelte/icons/circle-slash";
import Copy from "@lucide/svelte/icons/copy";
import CopyPlus from "@lucide/svelte/icons/copy-plus";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import Reply from "@lucide/svelte/icons/reply";
import Send from "@lucide/svelte/icons/send";
import Stamp from "@lucide/svelte/icons/stamp";

import { statusEntry, type StatusKey } from "@magna-carta/design-system/status-register";

import {
  countedLabel,
  menuOf,
  oneRecordGesture,
  type NounPair,
  type RecordMenuAction,
  type RecordMenuChoice,
  type RecordMenuFlyout,
  type RecordMenuModel,
} from "./record-menu-model.ts";

/** One ledger row the menu speaks for. */
export interface LedgerRecord {
  readonly identifier: string;
  /** Where the record stands in the firm's chain. The word and its tone come from one register. */
  readonly status: StatusKey;
  /** The matter-scoped number, or null on a record that has not been given one yet. */
  readonly entryNumber: string | null;
  /** What the record says it is for, as it reads on the row. */
  readonly description: string;
  /** The money, already formatted for reading. Copying it copies exactly what was on screen. */
  readonly amount: string;
}

export interface LedgerMenuContext {
  /** What this surface calls one of its records: a Time Entry, a Fee, a Cost. */
  readonly recordNoun: NounPair;
  /**
   * Whether the firm has review turned on. Off is the default, and off means the review vocabulary
   * does not appear at all.
   */
  readonly reviewGateEnabled: boolean;
  /**
   * Whether this surface offers moving a record to another ledger, and what it says about the one
   * the menu is speaking for.
   *
   * Optional, and absent by default: a surface that has not built the move does not advertise it,
   * and every existing caller keeps exactly the menu it had. Given, the verb renders — enabled with
   * its invitation, or disabled with the reason a record that is evidence cannot move.
   */
  readonly reclassify?: {
    readonly allowed: boolean;
    /** Why it can, or why it cannot. Either way it is the verb's hover. */
    readonly reason: string;
  };
}

/**
 * The words of the chain, taken from the product's one status register rather than spelled again.
 *
 * "Submit 3 Drafts" has to say Draft the same way the chip on the row says it, and the only way to
 * guarantee that is to read the same entry the chip reads.
 */
function statusNoun(key: StatusKey): NounPair {
  const label = statusEntry(key).label;
  return { singular: label, plural: `${label}s` };
}

export function ledgerRecordMenu(
  records: readonly LedgerRecord[],
  target: LedgerRecord,
  context: LedgerMenuContext,
): RecordMenuModel {
  const count = records.length;
  const noun = context.recordNoun;
  const drafts = records.filter((record) => record.status === "draft");
  const submitted = records.filter((record) => record.status === "submitted");

  return menuOf([
    { identifier: "record", items: [openVerb(), duplicateVerb(), copyValuesFlyout()] },
    { identifier: "chain", items: [submitVerb(), approveVerb(), kickBackVerb()] },
    { identifier: "ledger", items: [reclassifyVerb()] },
    { identifier: "destructive", items: [voidVerb()] },
  ]);

  function openVerb(): RecordMenuAction {
    return {
      kind: "action",
      identifier: "open",
      label: "Open",
      icon: FolderOpen,
      ...oneRecordGesture(count, `Open works on one ${noun.singular.toLowerCase()} at a time.`),
    };
  }

  /*
   * Duplicating starts a new draft from these fields — its own number, entered today, by whoever
   * is signed in. It counts, because starting three drafts from three entries is a coherent act.
   */
  function duplicateVerb(): RecordMenuAction {
    return {
      kind: "action",
      identifier: "duplicate",
      label: countedLabel({ verb: "Duplicate", count, noun }),
      icon: CopyPlus,
    };
  }

  /*
   * The flyout offers the values this record actually has. A record with no number yet does not
   * offer to copy one: an item that would put an empty string on the clipboard is worse than an
   * item that is not there.
   */
  function copyValuesFlyout(): RecordMenuFlyout {
    const choices: RecordMenuChoice[] = [];
    if (target.entryNumber !== null) {
      choices.push({ identifier: "entryNumber", label: `Entry Number: ${target.entryNumber}` });
    }
    if (target.description !== "") {
      choices.push({ identifier: "description", label: "Description" });
    }
    choices.push({ identifier: "amount", label: `Amount: ${target.amount}` });

    return {
      kind: "flyout",
      identifier: "copyValue",
      label: "Copy",
      icon: Copy,
      choices,
      ...oneRecordGesture(count, "Copying a value works on one record at a time."),
    };
  }

  /*
   * Each chain verb counts the records it can actually move, and is absent when there are none.
   * "Submit 0 Drafts" is not a verb, and a disabled one would be asking the reader to work out why.
   */
  function submitVerb(): RecordMenuAction | null {
    if (!context.reviewGateEnabled || drafts.length === 0) return null;
    return {
      kind: "action",
      identifier: "submit",
      label: countedLabel({ verb: "Submit", count: drafts.length, noun: statusNoun("draft") }),
      icon: Send,
    };
  }

  function approveVerb(): RecordMenuAction | null {
    if (!context.reviewGateEnabled || submitted.length === 0) return null;
    return {
      kind: "action",
      identifier: "approve",
      label: countedLabel({ verb: "Approve", count: submitted.length, noun }),
      icon: Stamp,
    };
  }

  function kickBackVerb(): RecordMenuAction | null {
    if (!context.reviewGateEnabled || submitted.length === 0) return null;
    return {
      kind: "action",
      identifier: "kickBack",
      label: countedLabel({ verb: "Kick Back", count: submitted.length, noun }),
      icon: Reply,
    };
  }

  /*
   * Moving a charge to another ledger: a misfiled record stops being stuck.
   *
   * It is a ONE-RECORD gesture and stays singular: each pair of ledgers carries different facts
   * across, so a move over a mixed selection would be several different decisions taken with one
   * press. A surface that has not built it passes nothing and the verb is simply not there.
   */
  function reclassifyVerb(): RecordMenuAction | null {
    const move = context.reclassify;
    if (move === undefined) return null;
    return {
      kind: "action",
      identifier: "reclassify",
      label: "Move to Another Ledger…",
      icon: ArrowRightLeft,
      ...(move.allowed
        ? oneRecordGesture(count, "A record moves between ledgers one at a time.")
        : { disabledReason: move.reason }),
    };
  }

  function voidVerb(): RecordMenuAction {
    const alreadyVoid = target.status === "void";
    return {
      kind: "action",
      identifier: "void",
      label: "Void",
      icon: CircleSlash,
      ...(alreadyVoid && count === 1
        ? { disabledReason: `Already ${statusEntry("void").label.toLowerCase()}.` }
        : oneRecordGesture(count, "Withdrawing is done one record at a time.")),
    };
  }
}
