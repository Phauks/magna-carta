/*
 * What a fee IS.
 *
 * A FEE IS A FLAT CHARGE FOR PROFESSIONAL SERVICES, RECORDED DIRECTLY. It is its own dated
 * work-in-progress record — a date, a timekeeper, a description, an amount, a billing disposition
 * and a place in the firm's chain — typed by hand from a New Fee control. It rides the same
 * lifecycle as a time entry and a cost, and a draft invoice claims it exactly as it claims either
 * of those. It is never computed from time entries, never derived from them, and never drawn out of
 * them: the amount is what somebody decided to charge, not the result of multiplying anything.
 *
 * THAT IS WHY THIS FILE DECLARES A RECORD AND NOT A PROJECTION. The surface before this one read
 * the matter's invoice lines and presented them as the fee ledger, which put the effect where the
 * cause belongs: an invoice line is what happens to a fee once a bill takes it up, and a ledger of
 * lines can show nothing that is still unbilled — which is the whole of what a work-in-progress
 * ledger is for.
 *
 * MONEY IS INTEGER MINOR UNITS. Every amount here is whole cents, summed as whole cents, and
 * divided by a hundred exactly once, at the render boundary. A fee reached through a float is a fee
 * that can be a cent wrong on a document a client is charged against.
 *
 * NOTHING SERVES THIS RECORD YET (fee-gaps.ts, `store`). The shape is declared here because the
 * screen is built against it: a surface written around whatever the wire happens to carry today
 * would have to be redesigned when the store lands, and the fields below are the fields the routes
 * are specified to carry.
 */
import { statusEntry, type StatusKey } from "@magna-carta/design-system/status-register";

/** The chain a fee rides: the same one a time entry and a cost ride, in the same words. */
export type FeeStatus = "draft" | "submitted" | "approved" | "billed" | "void";

/**
 * Where a record was first written down, when it was moved here from another ledger.
 *
 * The entry number is KEPT across a move, so a fee that began as a time entry carries a number
 * whose shape names Time. That is provenance and not a type assertion, and it is stated wherever
 * the number appears rather than left for a reader to trip over.
 */
export interface FeeProvenance {
  /** The ledger it came from, in that ledger's own word: "Time Entry", "Cost". */
  readonly fromRecordName: string;
  readonly movedOn: string;
  readonly movedByName: string;
}

/** One fee on the matter, as the fee routes are specified to serve it. */
export interface FeeRecord {
  readonly id: string;
  readonly matterId: string;
  /** The date the charge is for. It anchors the ledger, exactly as a cost's incurred date does. */
  readonly feeDate: string;
  /** The matter-scoped number, never reused. Null on a record that has not been given one. */
  readonly entryNumber: string | null;
  /** When it was written down, which is a different fact from the date it charges for. */
  readonly enteredDate: string | null;
  /** Who wrote it down, where that is not the timekeeper. Null where the read cannot say. */
  readonly enteredByName: string | null;
  /** Whose professional services the charge is for. The name is history, never a live join. */
  readonly timekeeperName: string | null;
  readonly timekeeperUserId: string | null;
  /** What the client reads on the bill. */
  readonly description: string;
  /** The flat charge, exactly as typed. Null only on a record that arrived without one. */
  readonly amountMinor: number | null;
  readonly currency: string;
  /** Whether the client may be asked for it. Absorbing it is the firm's decision, kept visible. */
  readonly billable: boolean;
  readonly status: FeeStatus;
  /** How many files ride the record. Null where the read does not carry the count. */
  readonly attachmentCount: number | null;
  /** For the firm alone. It never reaches a bill, a print sheet or the client portal. */
  readonly memo: string | null;
  readonly invoiceId: string | null;
  readonly invoiceNumber: string | null;
  /**
   * Whether the record is missing something its kind requires. A fee that arrived from another
   * ledger without an amount lands like this rather than being refused at the door: refusing would
   * leave the misfiling in place, which is the problem being fixed.
   */
  readonly incomplete: boolean;
  readonly provenance: FeeProvenance | null;
}

/** The status key the register draws this fee's chip from. One vocabulary, one tone each. */
export function feeStatusKey(status: FeeStatus): StatusKey {
  return status;
}

/** The word a fee's status wears, out of the product's one register. */
export function feeStatusLabel(status: FeeStatus): string {
  return statusEntry(feeStatusKey(status)).label;
}

/** How the billing disposition reads in the ledger's own words. */
export function billingLabel(billable: boolean): string {
  return billable ? "Billable" : "Non-billable";
}

/** What the disposition MEANS, on the hover. Meanings never print; they are read on demand. */
export function billingSentence(billable: boolean): string {
  return billable
    ? "Billable: it lands on the next draft invoice for this matter."
    : "Non-billable: recorded on the file, never charged to the client.";
}

/** A void fee counts toward nothing; it stays on the ledger as the record of what was withdrawn. */
export function countsInTotals(fee: FeeRecord): boolean {
  return fee.status !== "void";
}

/** Whether a draft invoice could still take this fee up. */
export function isClaimable(fee: FeeRecord): boolean {
  return fee.billable && !fee.incomplete && fee.status !== "billed" && fee.status !== "void";
}

/** The amount a figure counts, treating an unrecorded amount as nothing rather than as zero money. */
export function amountOf(fee: FeeRecord): number {
  return fee.amountMinor ?? 0;
}

/** The matter's fee position: what is waiting to be billed, and what a bill has taken up. */
export interface FeePosition {
  readonly unbilledMinor: number;
  readonly billedMinor: number;
}

/**
 * The two figures the footer states, over the fees given.
 *
 * Both count billable fees only, and neither counts a void: a withdrawn charge was never owed and a
 * non-billable one is never asked for, so including either would state a figure no bill will ever
 * carry.
 */
export function feePosition(fees: readonly FeeRecord[]): FeePosition {
  const live = fees.filter((fee) => countsInTotals(fee) && fee.billable);
  return {
    unbilledMinor: live
      .filter((fee) => fee.status !== "billed")
      .reduce((total, fee) => total + amountOf(fee), 0),
    billedMinor: live
      .filter((fee) => fee.status === "billed")
      .reduce((total, fee) => total + amountOf(fee), 0),
  };
}

/** How many fees are waiting for somebody to review them. */
export function submittedCount(fees: readonly FeeRecord[]): number {
  return fees.filter((fee) => fee.status === "submitted").length;
}

/**
 * Reading an amount somebody typed, as minor units.
 *
 * A fee is recorded exactly: the field takes what is being charged, with or without the currency
 * mark and the thousands separators a person naturally types, and nothing is computed from it. Zero
 * is not an amount — a charge of nothing was not made — so it reads as no answer. Everything stays
 * in whole cents from here on.
 */
export function parseAmountMinor(text: string): number | null {
  const trimmed = text.trim().replace(/^\$/, "").replaceAll(",", "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const minor = Math.round(Number(trimmed) * 100);
  return minor > 0 ? minor : null;
}

/**
 * Why a fee cannot be saved as it stands, in the words the reader needs, or null when it can.
 *
 * An advance control validates before it enables, so nothing is pressed only to come back with a
 * failure the client could have named. A fee names exactly two things: what is being charged, and
 * what for.
 */
export function feeDraftRefusal(input: {
  readonly amountText: string;
  readonly description: string;
}): string | null {
  if (parseAmountMinor(input.amountText) === null) return "Enter the amount of the charge";
  if (input.description.trim() === "") {
    return "Enter the Description: every fee states the work it charges for";
  }
  return null;
}

/** What an incomplete fee is still missing, as the sentence the row and the record both state. */
export function incompleteNote(fee: FeeRecord): string {
  const cameFrom =
    fee.provenance === null ? "" : ` It arrived here as a ${fee.provenance.fromRecordName}.`;
  return `This fee needs an amount before a bill can take it up.${cameFrom}`;
}

/**
 * What the hover over an entry number says.
 *
 * A number kept across a move names the ledger the record was FIRST written on, so a reader who
 * meets a Time-shaped number on the fee ledger is told why rather than left to guess.
 */
export function entryNumberTitle(fee: FeeRecord): string {
  if (fee.provenance === null) return "The matter-scoped entry number, never reused.";
  return (
    `Kept from this record's time on the ${fee.provenance.fromRecordName} ledger, so its shape ` +
    "records where it was first written down rather than what it is now. A reference that changes " +
    "is a reference that lies."
  );
}
