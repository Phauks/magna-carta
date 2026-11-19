/*
 * A reconciliation's figures, in one place: the server works them for the record and the screen
 * works them again the moment a box is ticked, before the server answers. Both call this, so the
 * two cannot disagree about a sum. Pure, and imports nothing but @magna-carta/money, so the web
 * app can load it.
 *
 * Items are signed (a deposit positive, a withdrawal negative). An IOLTA interest line is a
 * positive amount and a kind: credited interest counts as a deposit, a sweep as a withdrawal.
 */
import { isNegative } from "@magna-carta/money/compare";
import { fromMinor, toMinor } from "@magna-carta/money/format";
import {
  add,
  currencyFromCode,
  negate,
  subtract,
  sum,
  zero,
  type Money,
} from "@magna-carta/money/money";

export interface BankReconciliationFigures {
  readonly startBalanceMinor: number;
  readonly depositedMinor: number;
  readonly withdrawnMinor: number;
  readonly clearedBalanceMinor: number;
  readonly endBalanceMinor: number | null;
  /** End balance minus cleared balance; null until an end balance is entered. */
  readonly differenceMinor: number | null;
  readonly depositCount: number;
  readonly depositClearedCount: number;
  readonly withdrawalCount: number;
  readonly withdrawalClearedCount: number;
}

export interface FiguresItem {
  readonly amountMinor: number;
  readonly cleared: boolean;
}

export interface FiguresInterest {
  readonly kind: "credited" | "swept";
  readonly amountMinor: number;
  readonly cleared: boolean;
}

export function computeBankReconciliationFigures(
  currencyCode: string,
  startBalanceMinor: number,
  endBalanceMinor: number | null,
  items: readonly FiguresItem[],
  interest: readonly FiguresInterest[],
): BankReconciliationFigures {
  const currency = currencyFromCode(currencyCode);
  const lines: { readonly amount: Money; readonly cleared: boolean }[] = [
    ...items.map((item) => ({
      amount: fromMinor(item.amountMinor, currency),
      cleared: item.cleared,
    })),
    ...interest.map((line) => {
      const amount = fromMinor(line.amountMinor, currency);
      return { amount: line.kind === "credited" ? amount : negate(amount), cleared: line.cleared };
    }),
  ];
  let deposited = zero(currency);
  let withdrawn = zero(currency);
  let depositCount = 0;
  let depositClearedCount = 0;
  let withdrawalCount = 0;
  let withdrawalClearedCount = 0;
  for (const line of lines) {
    if (isNegative(line.amount)) {
      withdrawalCount += 1;
      if (line.cleared) {
        withdrawalClearedCount += 1;
        withdrawn = subtract(withdrawn, line.amount);
      }
    } else {
      depositCount += 1;
      if (line.cleared) {
        depositClearedCount += 1;
        deposited = add(deposited, line.amount);
      }
    }
  }
  const start = fromMinor(startBalanceMinor, currency);
  const cleared = subtract(add(start, deposited), withdrawn);
  return {
    startBalanceMinor,
    depositedMinor: toMinor(deposited),
    withdrawnMinor: toMinor(withdrawn),
    clearedBalanceMinor: toMinor(cleared),
    endBalanceMinor,
    differenceMinor:
      endBalanceMinor === null
        ? null
        : toMinor(subtract(fromMinor(endBalanceMinor, currency), cleared)),
    depositCount,
    depositClearedCount,
    withdrawalCount,
    withdrawalClearedCount,
  };
}

/** The interest of one kind, added up: what the bank credited, or what was swept out. */
export function interestTotalMinor(
  currencyCode: string,
  interest: readonly Pick<FiguresInterest, "kind" | "amountMinor">[],
  kind: FiguresInterest["kind"],
): number {
  const currency = currencyFromCode(currencyCode);
  return toMinor(
    sum([
      zero(currency),
      ...interest
        .filter((line) => line.kind === kind)
        .map((line) => fromMinor(line.amountMinor, currency)),
    ]),
  );
}

/** The change over a period: the end balance less the start, null until there is an end. */
export function balanceChangeMinor(
  currencyCode: string,
  startBalanceMinor: number,
  endBalanceMinor: number | null,
): number | null {
  if (endBalanceMinor === null) return null;
  const currency = currencyFromCode(currencyCode);
  return toMinor(
    subtract(fromMinor(endBalanceMinor, currency), fromMinor(startBalanceMinor, currency)),
  );
}
