import type { AccountType, Direction } from "./types.ts";

// THE home of the normal-balance rule: derived in code, never a column.
export function normalBalanceFor(type: AccountType): Direction {
  return type === "asset" || type === "expense" ? "debit" : "credit";
}

// One line's contribution to its account's materialized balance, in normal-balance terms
// (positive = normal): +amount when the line direction matches the account's normal balance.
export function balanceDelta(type: AccountType, direction: Direction, amountMinor: number): number {
  return direction === normalBalanceFor(type) ? amountMinor : -amountMinor;
}
