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
 * THE SHAPE BELOW IS THE WIRE'S. `FeeSummary` on the fee routes carries exactly these fields, so a
 * listing's rows are fee records without a translation step between them. Facts the store does not
 * hold yet — an entry number, the files riding a record, the number of the bill that billed it —
 * are NOT optional fields waiting to be filled: they are absent, and the columns that name them say
 * what they wait on (fee-gaps.ts), the same way the cost ledger's do.
 */
import { statusEntry, type StatusKey } from "@magna-carta/design-system/status-register";

/** The chain a fee rides: the same one a time entry and a cost ride, in the same words. */
export type FeeStatus = "draft" | "submitted" | "approved" | "billed" | "void";

/** One fee on the matter, as the fee routes serve it. */
export interface FeeRecord {
  readonly id: string;
  readonly matterId: string;
  /** The date the charge is for. It anchors the ledger, exactly as a cost's incurred date does. */
  readonly serviceDate: string;
  /** Whose professional services the charge is for. The name is history, never a live join. */
  readonly timekeeperUserId: string | null;
  readonly timekeeperName: string | null;
  /** What the client reads on the bill. */
  readonly description: string;
  /** The flat charge, exactly as typed. The store refuses a charge of nothing. */
  readonly amountMinor: number;
  readonly currency: string;
  /** Whether the client may be asked for it. Absorbing it is the firm's decision, kept visible. */
  readonly billable: boolean;
  readonly status: FeeStatus;
  /**
   * Why a reviewer sent this fee back, or null.
   *
   * The kick-back transition sets it and returns the fee to draft; the next submission clears it.
   * So a non-null value means "this draft came back and has not been sent again" — the only thing
   * telling a returned draft from one nobody has submitted.
   */
  readonly kickBackReason: string | null;
  /** The bill that took it up, or null while nothing has. */
  readonly invoiceId: string | null;
  /** For the firm alone. It never reaches a bill, a print sheet or the client portal. */
  readonly memo: string | null;
  /**
   * When it was written down — a moment, not a day, and not the day the work was done.
   *
   * A charge captured three weeks after the fact is a different record from one captured the day
   * the work happened, and only this and `serviceDate` together say which of the two a reader has.
   */
  readonly createdAt: string;
  /**
   * Who wrote it down, as an identifier and as a name.
   *
   * Both, because they answer different questions: the name is what a reader is shown, and a null
   * name over a present identifier means the member row is gone rather than that nobody recorded
   * it. It is not a permission fact — a fee belongs to the matter it charges and not to its
   * recorder, so nothing about a fee is scoped by this.
   */
  readonly createdByUserId: string | null;
  readonly createdByName: string | null;
  /**
   * The matter's own name and number, resolved by the listing.
   *
   * A firm-wide period listing prints the matter on every row, and resolving it a row at a time
   * would be a lookup per charge to fill one column.
   */
  readonly matterNumber?: string | null;
  readonly matterTitle?: string | null;
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
    ? "Billable. It goes on the next draft bill for this matter."
    : "Non-billable: recorded on the file, never charged to the client.";
}

/** A void fee counts toward nothing; it stays on the ledger as the record of what was withdrawn. */
export function countsInTotals(fee: FeeRecord): boolean {
  return fee.status !== "void";
}

/** Whether a draft invoice could still take this fee up. */
export function isClaimable(fee: FeeRecord): boolean {
  return fee.billable && fee.status !== "billed" && fee.status !== "void";
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
      .reduce((total, fee) => total + fee.amountMinor, 0),
    billedMinor: live
      .filter((fee) => fee.status === "billed")
      .reduce((total, fee) => total + fee.amountMinor, 0),
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

/** What a fee reads as where the matter is a column rather than the screen it stands on. */
export function feeMatterText(fee: FeeRecord): string {
  const title = fee.matterTitle ?? "";
  const number = fee.matterNumber ?? "";
  if (title === "" && number === "") return "Not resolved";
  if (number === "") return title;
  return title === "" ? number : `${number} — ${title}`;
}
