/*
 * The reconciliation screens' words and arithmetic, away from the markup so they can be checked
 * without a browser. Labels follow docs/conventions/ux-copy.md: the word familiar software uses, in
 * one or two words.
 */
import { computeBankReconciliationFigures } from "@magna-carta/trust/bank-reconciliation-figures";
import { formatDate } from "@magna-carta/design-system/formatters";
import { readAmountMinor } from "$lib/billing/amount-entry.ts";
import type {
  TrustBankReconciliationChange,
  TrustBankReconciliationDetail,
  TrustBankReconciliationItem,
  TrustBankReconciliationLine,
  TrustBankReconciliationNote,
  TrustBankReconciliationSummary,
} from "./reconciliation-api.ts";

export type ItemType = TrustBankReconciliationItem["type"];

/** The type filter's choices, in the order the filter lists them. */
export const TYPE_FILTERS = [
  "check",
  "cash",
  "wire",
  "electronic_transfer",
  "card",
  "bank_charge",
  "other",
] as const;
export type TypeFilter = "all" | (typeof TYPE_FILTERS)[number];

/** What a line's type is called. */
export function typeLabel(type: ItemType | TypeFilter): string {
  switch (type) {
    case "all":
      return "All Types";
    case "check":
      return "Check";
    case "cash":
      return "Cash";
    case "wire":
      return "Wire";
    case "electronic_transfer":
      return "Electronic";
    case "card":
      return "Card";
    case "bank_charge":
      return "Bank Charge";
    case "transfer":
      return "Transfer";
    case "internal":
    case "other":
      return "Other";
  }
}

/** Which filter a line's type falls under: transfers and internal moves read as Other. */
export function typeFilterOf(type: ItemType): Exclude<TypeFilter, "all"> {
  return type === "transfer" || type === "internal" ? "other" : type;
}

export type StateFilter = "all" | "uncleared" | "review" | "new";

export function lineKey(line: TrustBankReconciliationLine): string {
  return line.kind === "entry" ? `entry:${line.entryId}` : `interest:${line.interestId}`;
}

export const entryLine = (entryId: string): TrustBankReconciliationLine => ({
  kind: "entry",
  entryId,
});
export const interestLine = (interestId: string): TrustBankReconciliationLine => ({
  kind: "interest",
  interestId,
});

/** The lines marked Needs review now: the latest review mark on each line decides. */
export function linesNeedingReview(
  notes: readonly TrustBankReconciliationNote[],
): ReadonlySet<string> {
  const latest = new Map<string, TrustBankReconciliationNote["kind"]>();
  for (const note of notes) {
    if (note.kind !== "note") latest.set(lineKey(note.line), note.kind);
  }
  return new Set([...latest].filter(([, kind]) => kind === "needs_review").map(([key]) => key));
}

/** How many notes each line has. */
export function noteCounts(
  notes: readonly TrustBankReconciliationNote[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const note of notes) {
    if (note.kind !== "note") continue;
    const key = lineKey(note.line);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** "Oct 16, 2026 to Oct 31, 2026": both ends in full, years on both. */
export function periodText(startDate: string, endDate: string): string {
  return `${formatDate(startDate)} to ${formatDate(endDate)}`;
}

export type ReconciliationStatus = "in-progress" | "reconciled" | "difference";

export function statusOf(
  summary: Pick<TrustBankReconciliationSummary, "differenceMinor"> & {
    readonly reconciliation: { readonly finishedAt: string | null };
  },
): ReconciliationStatus {
  if (summary.reconciliation.finishedAt === null) return "in-progress";
  return summary.differenceMinor === 0 ? "reconciled" : "difference";
}

export function statusLabel(status: ReconciliationStatus): string {
  switch (status) {
    case "in-progress":
      return "In Progress";
    case "reconciled":
      return "Reconciled";
    case "difference":
      return "Finished With a Difference";
  }
}

export function statusTone(status: ReconciliationStatus): "info" | "success" | "danger" {
  return status === "in-progress" ? "info" : status === "reconciled" ? "success" : "danger";
}

/**
 * A balance as typed: dollars and cents, negative with a minus sign or in brackets, since a trust
 * bank account can be overdrawn. Null when the box is empty, a sentence when it is not an amount.
 */
export function readBalanceMinor(text: string): number | null | { readonly refused: string } {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const negative = trimmed.startsWith("-") || (trimmed.startsWith("(") && trimmed.endsWith(")"));
  const reading = readAmountMinor(trimmed.replace(/^-|^\(|\)$/g, ""));
  if (reading.kind === "empty") return null;
  if (reading.kind === "refused") return { refused: reading.reason };
  return negative ? -reading.minor : reading.minor;
}

/** Balance text for a field: plain digits and a point, a minus sign when negative. */
export function balanceFieldText(minor: number | null): string {
  if (minor === null) return "";
  const negative = minor < 0;
  const magnitude = Math.abs(minor);
  return `${negative ? "-" : ""}${Math.floor(magnitude / 100)}.${String(magnitude % 100).padStart(2, "0")}`;
}

/** What one change did, in a sentence for History. */
export function changeSentence(
  change: TrustBankReconciliationChange,
  detail: Pick<TrustBankReconciliationDetail, "items" | "interest">,
  money: (minor: number) => string,
): string {
  if (change.kind === "end_date") return `Set the end date to ${formatDate(change.endDate ?? "")}`;
  if (change.kind === "end_balance") {
    return `Set the end balance to ${money(change.endBalanceMinor ?? 0)}`;
  }
  const verb = change.kind === "cleared" ? "Ticked" : "Unticked";
  return `${verb} ${lineDescription(change.line, detail, money)}`;
}

/** A line named the way a person would say it: "Check 10418, Reno Courier LLC, $1,250.00". */
export function lineDescription(
  line: TrustBankReconciliationLine | null,
  detail: Pick<TrustBankReconciliationDetail, "items" | "interest">,
  money: (minor: number) => string,
): string {
  if (line === null) return "a line";
  if (line.kind === "interest") {
    const interest = detail.interest.find((candidate) => candidate.interestId === line.interestId);
    return interest === undefined
      ? "an interest line since removed"
      : `${interest.description}, ${money(Math.abs(interest.amountMinor))}`;
  }
  const item = detail.items.find((candidate) => candidate.entryId === line.entryId);
  if (item === undefined) return "an item outside these dates";
  const parts = [
    item.number === null ? typeLabel(item.type) : `${typeLabel(item.type)} ${item.number}`,
    item.payeeOrFrom,
    money(Math.abs(item.amountMinor)),
  ];
  return parts.filter((part): part is string => part !== null && part !== "").join(", ");
}

/** Why a change happened, for History, when it was not a plain edit. */
export function causeLabel(change: TrustBankReconciliationChange): string | null {
  switch (change.cause) {
    case "edit":
      return null;
    case "undo":
      return "Undo";
    case "redo":
      return "Redo";
    case "history":
      return "Undone from History";
    case "restore":
      return "Restore";
  }
}

/** The lines a filter keeps. */
export function filterItems(
  items: readonly TrustBankReconciliationItem[],
  type: TypeFilter,
  state: StateFilter,
  review: ReadonlySet<string>,
): readonly TrustBankReconciliationItem[] {
  return items.filter((item) => {
    if (type !== "all" && typeFilterOf(item.type) !== type) return false;
    if (state === "uncleared") return !item.cleared;
    if (state === "review") return review.has(`entry:${item.entryId}`);
    if (state === "new") return item.isNew;
    return true;
  });
}

/** How many lines each type filter would show. */
export function typeCounts(
  items: readonly TrustBankReconciliationItem[],
): ReadonlyMap<TypeFilter, number> {
  const counts = new Map<TypeFilter, number>([["all", items.length]]);
  for (const item of items) {
    const type = typeFilterOf(item.type);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return counts;
}

/**
 * The figures for a set of lines, worked by the same function the server works them with: the
 * start balance, plus the cleared deposits, less the cleared withdrawals, against the end balance.
 * A credited interest line is a deposit and a swept one a withdrawal.
 */
export function figuresOf(
  currency: string,
  startBalanceMinor: number,
  endBalanceMinor: number | null,
  items: readonly Pick<TrustBankReconciliationItem, "amountMinor" | "cleared">[],
  interest: readonly Pick<
    TrustBankReconciliationDetail["interest"][number],
    "amountMinor" | "cleared" | "kind"
  >[],
): TrustBankReconciliationDetail["figures"] {
  return computeBankReconciliationFigures(
    currency,
    startBalanceMinor,
    endBalanceMinor,
    items,
    interest,
  );
}

/**
 * The reconciliation as it reads the moment a person ticks or unticks lines, before the server
 * answers: the lines' marks and the figures they move. The next read replaces it.
 */
export function withTicks(
  detail: TrustBankReconciliationDetail,
  ticks: readonly { readonly line: TrustBankReconciliationLine; readonly cleared: boolean }[],
): TrustBankReconciliationDetail {
  const marks = new Map(ticks.map((tick) => [lineKey(tick.line), tick.cleared]));
  const items = detail.items.map((item) => {
    const mark = marks.get(`entry:${item.entryId}`);
    return mark === undefined ? item : { ...item, cleared: mark };
  });
  const interest = detail.interest.map((line) => {
    const mark = marks.get(`interest:${line.interestId}`);
    return mark === undefined ? line : { ...line, cleared: mark };
  });
  return {
    ...detail,
    items,
    interest,
    figures: figuresOf(
      detail.reconciliation.currency,
      detail.reconciliation.startBalanceMinor,
      detail.endBalanceMinor,
      items,
      interest,
    ),
  };
}

/** The reconciliation with a new end balance, before the server answers. */
export function withEndBalance(
  detail: TrustBankReconciliationDetail,
  endBalanceMinor: number,
): TrustBankReconciliationDetail {
  return {
    ...detail,
    endBalanceMinor,
    figures: figuresOf(
      detail.reconciliation.currency,
      detail.reconciliation.startBalanceMinor,
      endBalanceMinor,
      detail.items,
      detail.interest,
    ),
  };
}
