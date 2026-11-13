/*
 * Moving a charge between the Time, Fees and Costs ledgers.
 *
 * THE PROBLEM THIS SOLVES. Somebody records a charge in the wrong place — a flat charge typed onto
 * the time sheet, a disbursement written up as a fee — and today the only remedy is to withdraw it
 * and write it again somewhere else, which spends a number, leaves a void on the ledger, and loses
 * the files and the note that were attached to it. A charge that can move is a charge that stops
 * being stuck.
 *
 * WHILE IT IS STILL THE FIRM'S OWN TO CHANGE. A record moves while it is a draft this account may
 * work, is on no bill, and is not held by a draft invoice's claim. Past any of those it is evidence
 * somebody is relying on, and the answer is to void it and record it again. The refusal always says
 * which of those it is, because they call for different next steps.
 *
 * WHAT CARRIES IS STATED BEFORE THE MOVE, PER PAIR. Not in general: the differences between the
 * pairs ARE the decision. Time to fee turns a computed amount into a typed one and drops hours and
 * rate, which mean nothing on a flat charge. Fee or cost to time is the hard direction, because
 * time needs hours and a rate that neither of them ever had.
 *
 * THE ENTRY NUMBER IS KEPT. A reference that changes is a reference that lies — a note, an email or
 * a printed sheet that cited it must keep resolving. The consequence is stated rather than hidden:
 * because a number's shape names the ledger a record was FIRST written on, a moved record carries a
 * prefix that is provenance and not a type assertion, and it says so wherever the number appears.
 *
 * A RECORD THAT ARRIVES INCOMPLETE OPENS INCOMPLETE. It lands as a draft that names what it is
 * missing, shows that in the list where the figure would sit, and cannot be claimed onto a bill
 * until it is filled in. Refusing at the door would leave the misfiling exactly where it was, which
 * is the problem being fixed.
 *
 * This module is the model only — pure, so the words and the refusals can be asserted without a
 * browser. The dialog that renders it is reclassify-dialog.svelte; nothing here knows it exists.
 */

/** The three ledgers a charge can live on. */
export type LedgerKind = "time" | "fee" | "cost";

export const LEDGER_KINDS: readonly LedgerKind[] = ["time", "fee", "cost"];

/** What one record of each kind is called, in the words its own surface uses. */
export const LEDGER_RECORD_NAME: Readonly<Record<LedgerKind, string>> = {
  time: "Time Entry",
  fee: "Fee",
  cost: "Cost",
};

/** What each ledger's own tab is called. A move names the destination the way the reader finds it. */
export const LEDGER_NAME: Readonly<Record<LedgerKind, string>> = {
  time: "Time",
  fee: "Fees",
  cost: "Costs",
};

/** What a record of each kind IS, in one phrase, so the choice is never a guess. */
export const LEDGER_SHAPE: Readonly<Record<LedgerKind, string>> = {
  time: "hours worked, at a rate",
  fee: "a flat charge, typed",
  cost: "money spent, payee optional",
};

/** The facts about a record that decide whether it may move, and what would carry if it did. */
export interface ReclassifiableRecord {
  /** Where it lives now. */
  readonly kind: LedgerKind;
  /** Its status, in the chain's own word: draft, submitted, approved, billed, void. */
  readonly status: string;
  /** The invoice number it was billed on, where it was. */
  readonly invoiceNumber: string | null;
  /** Whether a draft invoice is holding it. A claim is somebody relying on it. */
  readonly claimedByDraftInvoice: boolean;
  /** Whether this account may work this draft, and who may where it may not. */
  readonly mayWork: boolean;
  /** Who may work it, for the refusal that names them. */
  readonly workersDescription: string;
  /** The amount as recorded, in minor units, or null where the record carries none. */
  readonly amountMinor: number | null;
}

/** Whether this record can move, and the sentence that says why either way. */
export interface ReclassifyVerdict {
  readonly allowed: boolean;
  readonly reason: string;
}

/**
 * Whether a record is still the firm's own to move.
 *
 * The order of the checks is the order of the facts a reader needs: withdrawn first, then billed,
 * then claimed, then the chain, then who may work it. Each refusal names the one thing that would
 * change the answer.
 */
export function mayReclassify(record: ReclassifiableRecord): ReclassifyVerdict {
  const recordName = LEDGER_RECORD_NAME[record.kind].toLowerCase();
  if (record.status === "void") {
    return {
      allowed: false,
      reason: `A void ${recordName} is frozen: it stays as the record of what was withdrawn.`,
    };
  }
  if (record.invoiceNumber !== null) {
    return {
      allowed: false,
      reason: `Billed on ${record.invoiceNumber}. Items on a finalized bill can't be moved. To correct it, add a credit note.`,
    };
  }
  if (record.claimedByDraftInvoice) {
    return {
      allowed: false,
      reason:
        "A draft bill is holding this. Release the claim on the Billing tab, and then it can move.",
    };
  }
  if (record.status !== "draft") {
    return {
      allowed: false,
      reason: `Only a draft moves between ledgers. This one is ${record.status}.`,
    };
  }
  if (!record.mayWork) {
    return {
      allowed: false,
      reason: `Only ${record.workersDescription} can move this draft.`,
    };
  }
  return {
    allowed: true,
    reason: `Move this ${recordName} to another ledger. It's a draft, so nothing depends on it yet.`,
  };
}

/** What survives the move and what does not, for the exact pair chosen. */
export interface CarryFacts {
  readonly keeps: readonly string[];
  readonly loses: readonly string[];
}

/**
 * What carries from one ledger to another, stated per pair.
 *
 * `money` renders an amount the way the surface renders every other amount, so the sentence quotes
 * the same figure the reader is looking at rather than a second formatting of it.
 */
export function carryFacts(
  from: LedgerKind,
  to: LedgerKind,
  record: { readonly amountMinor: number | null },
  money: (amountMinor: number) => string,
): CarryFacts {
  const keeps: string[] = [
    "Date, description and the entry number",
    "Attachments, the internal memo and the whole history",
  ];
  const loses: string[] = [];
  const amount = record.amountMinor;

  const amountCarriesAs = (what: string): void => {
    if (amount === null) {
      loses.push(
        `No amount to carry, so the ${LEDGER_RECORD_NAME[to].toLowerCase()} opens without one`,
      );
      return;
    }
    keeps.push(`${what} (${money(amount)})`);
  };

  if (from === "time" && to === "fee") {
    amountCarriesAs("The computed amount becomes the fee's amount");
    loses.push("Hours and rate stop meaning anything on a flat charge and do not carry");
  } else if (from === "time" && to === "cost") {
    amountCarriesAs("The computed amount becomes the cost's amount");
    loses.push("Hours and rate do not carry; the payee starts empty and is optional");
  } else if (from === "fee" && to === "time") {
    amountCarriesAs("The amount is held as the target amount");
    loses.push(
      "Time needs hours and a rate, which a flat fee doesn't have. It opens as an incomplete draft that can't be billed until you add them.",
    );
  } else if (from === "cost" && to === "time") {
    amountCarriesAs("The amount is held as the target amount");
    loses.push("The payee and the expense code do not carry");
    loses.push(
      "Time needs hours and a rate. It opens as an incomplete draft that can't be billed until you add them.",
    );
  } else if (from === "fee" && to === "cost") {
    amountCarriesAs("The amount carries exactly");
    keeps.push("The payee starts empty, and is optional");
  } else if (from === "cost" && to === "fee") {
    amountCarriesAs("The amount carries exactly");
    loses.push("The payee and the expense code do not carry");
  }

  return { keeps, loses };
}

/** The line the dialog's footer states, whichever pair is chosen. */
export function keptNumberNote(entryNumber: string | null): string {
  return entryNumber === null
    ? "The entry number is kept, and the move is recorded on the record's history."
    : `The entry number stays ${entryNumber}; the move is recorded in its history.`;
}

/** The hover a moved record's number carries, wherever that number appears. */
export function movedNumberTitle(fromRecordName: string): string {
  return `Kept from when this was on the ${fromRecordName} ledger, so the number shows where it was first recorded. Numbers never change once given.`;
}
