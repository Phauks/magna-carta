/*
 * The fee agreement, in words — what a matter's billing arrangement is called, and what its terms
 * actually say.
 *
 * THE ARRANGEMENT IS HOW THE MATTER IS BILLED, NOT WHERE ITS FEES COME FROM. A fee is a flat charge
 * somebody records by hand — its own dated draft on the Fees ledger — so nothing here computes one.
 * What the arrangement decides is how the matter's work reaches a bill at all: hourly time at its
 * rates, a flat fee, a share of a recovery, an evergreen retainer. This module states what the
 * arrangement IS and stops there.
 *
 * AN AMENDMENT IS A NEW VERSION, NEVER AN EDIT. Every bill records the version it was composed
 * under, so the version it was composed under has to still exist. The history is append-only and
 * the surface presents it that way.
 *
 * ABSENCE MEANS HOURLY. A matter with no recorded arrangement is billed hourly, because that is what
 * the platform does when nothing else was agreed — and saying so out loud is different from showing
 * an empty panel.
 */
import type { ArrangementKind, ArrangementVersion, ContingencyBasis } from "./billing-api.ts";
import { shareFieldText } from "./amount-entry.ts";

/** What each kind of agreement is called, in the firm's own words. */
export const ARRANGEMENT_KIND_LABELS: Readonly<Record<ArrangementKind, string>> = {
  hourly: "Hourly",
  flat_fee: "Flat Fee",
  contingency: "Contingency",
  retainer: "Evergreen Retainer",
};

/** The kinds in the order the amendment control offers them. */
export const ARRANGEMENT_KINDS: readonly ArrangementKind[] = [
  "hourly",
  "flat_fee",
  "contingency",
  "retainer",
];

/**
 * Which way the costs election runs, in the words the written agreement has to use.
 *
 * This is the one term a contingency agreement must state and a client signs: whether expenses come
 * off before the fee is computed or after it. There is no default, because either answer is
 * ordinary and guessing states a wrong fact about somebody's money.
 */
export const CONTINGENCY_BASIS_LABELS: Readonly<Record<ContingencyBasis, string>> = {
  gross_recovery: "Fee first: computed on the gross recovery, costs deducted after",
  net_after_costs: "Costs first: advanced costs come off, the fee is computed on the net",
};

/** The same election, short enough to sit at the end of a one-line summary. */
const CONTINGENCY_BASIS_SHORT: Readonly<Record<ContingencyBasis, string>> = {
  gross_recovery: "after the fee (gross recovery)",
  net_after_costs: "before the fee (net after costs)",
};

/**
 * Where an advance fee sits until it is earned.
 *
 * Recorded, never defaulted: jurisdictions genuinely differ on where an advance fee must sit, and a
 * wrong silence states a wrong fact about client money.
 */
export const DEPOSIT_DESTINATION_LABELS = {
  trust: "The trust account",
  operating: "The operating account",
} as const;

/** Whether a kind of agreement takes an advance deposit at all. */
export function takesAdvanceDeposit(kind: ArrangementKind): boolean {
  return kind === "flat_fee" || kind === "retainer";
}

/**
 * The agreement's terms, as one line.
 *
 * Every fact a reader needs to know what this matter charges, in the order they would ask for it.
 * Money arrives already rendered, because the currency and the locale belong to the surface.
 */
export function arrangementTerms(
  version: ArrangementVersion | null,
  money: (amountMinor: number) => string,
): string {
  if (version === null) {
    return "Nothing else was agreed, so the matter is billed hourly: rates resolve per timekeeper from the firm's rate cards.";
  }
  switch (version.kind) {
    case "hourly":
      return "Rates resolve per timekeeper from the firm's rate cards in force on each work date.";
    case "flat_fee": {
      const amount =
        version.flatFeeAmountMinor === null
          ? "an unrecorded amount"
          : money(version.flatFeeAmountMinor);
      return `${amount} for the engagement · advance deposit sits in ${depositWord(version)}.`;
    }
    case "contingency": {
      const share =
        version.contingencyShareE4 === null
          ? "an unrecorded share"
          : `${shareFieldText(version.contingencyShareE4)}%`;
      const basis =
        version.contingencyBasis === null
          ? "with the costs election unrecorded"
          : `costs deduct ${CONTINGENCY_BASIS_SHORT[version.contingencyBasis]}`;
      return `${share} of any recovery · ${basis}.`;
    }
    default: {
      const target =
        version.retainerTargetMinor === null
          ? "an unrecorded target"
          : money(version.retainerTargetMinor);
      const floor =
        version.retainerThresholdMinor === null
          ? "an unrecorded floor"
          : money(version.retainerThresholdMinor);
      return `Target ${target} · replenish below ${floor} · advance deposit sits in ${depositWord(version)}.`;
    }
  }
}

function depositWord(version: ArrangementVersion): string {
  if (version.advanceDepositDestination === null) return "an account nobody recorded";
  return version.advanceDepositDestination === "trust" ? "trust" : "operating";
}

/** The note that rides beneath the amendment fields for each kind, stating what it commits to. */
export function amendmentNote(kind: ArrangementKind): string {
  switch (kind) {
    case "hourly":
      return "Nothing else to record: rates resolve per timekeeper from the firm's rate cards in force on each work date.";
    case "flat_fee":
      return "Time is still tracked, but the client is charged the fee. Costs are billed separately.";
    case "contingency":
      return "The written agreement must say whether expenses come off before or after the fee is calculated. Choose the answer the client signed.";
    default:
      return "The floor is a business setting for replenishment asks: never the trust ledger's structural no-negative floor.";
  }
}

/** How a version names itself in a list: "Version 2: Flat Fee". */
export function versionTitle(version: ArrangementVersion): string {
  return `Version ${String(version.version)}: ${ARRANGEMENT_KIND_LABELS[version.kind]}`;
}

/** The dates a version governed, as a reader reads them. */
export function versionPeriod(
  version: ArrangementVersion,
  formatDate: (isoDate: string) => string,
): string {
  const from = formatDate(version.validFrom);
  return version.validTo === null ? `${from} to now` : `${from} to ${formatDate(version.validTo)}`;
}

/**
 * The sentence the amendment surface prints, because it is the thing people get wrong about
 * amending a fee agreement.
 */
export const AMENDMENT_STANDING_NOTE =
  "An amendment creates a new version. The old version stays on record with the dates it applied, because bills made under it refer to it.";
