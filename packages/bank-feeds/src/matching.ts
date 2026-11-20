/*
 * Which of the bank's lines are already in the books, and which are not.
 *
 * This decides a LABEL on the Banking screen and nothing else. It posts nothing, clears nothing on a
 * reconciliation, and a person is free to disagree with it: a line marked In Books is one the books
 * hold an entry for, not one anybody has confirmed.
 *
 * THE RULE. A bank line is In Books when the account's book has an entry of exactly the same
 * signed amount dated within `DATE_WINDOW_DAYS` of it that no other bank line has taken. Each book
 * entry answers for one bank line at most, so two $500.00 deposits need two $500.00 entries. When a
 * line could take more than one entry, it takes the closest in date (then the earliest), and its
 * neighbours are left the rest; the order lines are considered in is by date, then by the bank's id,
 * so the answer is the same every time it is asked.
 *
 * NEVER SUMS. A bank deposit that equals several book entries added together is left Not in Books.
 * The owner ruled on the reconciliation screen that suggestions never add lines together, because a
 * sum that happens to agree is how a misposted deposit hides; the same holds here.
 *
 * A pending bank line is neither: the bank has not posted it, so it is reported as Pending and takes
 * no book entry.
 */

/** How far apart, in days, a bank line and a book entry may be dated and still be the same money. */
export const DATE_WINDOW_DAYS = 7;

export interface BankLine {
  readonly id: string;
  readonly postedOn: string; // YYYY-MM-DD
  readonly amountMinor: number; // positive is money in
  readonly pending: boolean;
}

export interface BookLine {
  readonly id: string;
  readonly effectiveOn: string; // YYYY-MM-DD
  readonly amountMinor: number; // positive is money in (a debit to the bank account)
}

export type BankLineStatus =
  | { readonly status: "inBooks"; readonly bookLineId: string }
  | { readonly status: "notInBooks" }
  | { readonly status: "pending" };

const DAY_MS = 86_400_000;

function dayNumber(civilDate: string): number {
  return Math.round(Date.parse(`${civilDate}T00:00:00Z`) / DAY_MS);
}

export function matchBankLines(
  bankLines: readonly BankLine[],
  bookLines: readonly BookLine[],
): Map<string, BankLineStatus> {
  const result = new Map<string, BankLineStatus>();
  const byAmount = new Map<number, { line: BookLine; day: number; taken: boolean }[]>();
  for (const line of bookLines) {
    const bucket = byAmount.get(line.amountMinor) ?? [];
    bucket.push({ line, day: dayNumber(line.effectiveOn), taken: false });
    byAmount.set(line.amountMinor, bucket);
  }
  for (const bucket of byAmount.values()) {
    bucket.sort((a, b) => a.day - b.day || (a.line.id < b.line.id ? -1 : 1));
  }

  const ordered = [...bankLines].sort((a, b) =>
    a.postedOn === b.postedOn ? (a.id < b.id ? -1 : 1) : a.postedOn < b.postedOn ? -1 : 1,
  );
  for (const bankLine of ordered) {
    if (bankLine.pending) {
      result.set(bankLine.id, { status: "pending" });
      continue;
    }
    const day = dayNumber(bankLine.postedOn);
    let best: { line: BookLine; day: number; taken: boolean } | null = null;
    for (const candidate of byAmount.get(bankLine.amountMinor) ?? []) {
      if (candidate.taken) continue;
      const distance = Math.abs(candidate.day - day);
      if (distance > DATE_WINDOW_DAYS) continue;
      if (best === null || distance < Math.abs(best.day - day)) best = candidate;
    }
    if (best === null) {
      result.set(bankLine.id, { status: "notInBooks" });
    } else {
      best.taken = true;
      result.set(bankLine.id, { status: "inBooks", bookLineId: best.line.id });
    }
  }
  return result;
}
