import type { ResolvedMatterAssetValue } from "./as-of.ts";
import type {
  MatterAssetEncumbranceRow,
  ResolvedEncumbranceBalance,
} from "./encumbrance-statements.ts";

// Net equity: what is left of an asset's value once what is secured against it is taken off, as of
// one date.
//
// EQUITY IS COMPUTED AND NEVER STORED. There is no equity column on any table, for the same reason
// there is no current-value column: it is a function of two dated assertions, and a stored copy would
// be a third number free to disagree with both the moment either moved.
//
// NOTHING IS EVER SUMMED ACROSS CURRENCIES. A house valued in dollars charged by a mortgage recorded
// in pounds nets to nothing this module will state — it reports both sides per currency and says the
// equity is unavailable, because the exchange rate on a date is a fact the firm's data does not carry
// and one this package will not invent. An approximated total on an inventory a court reads is worse
// than a stated gap.
//
// A RELEASED ENCUMBRANCE IS EXCLUDED BY DATE, not by its row being gone: the caller narrows to the
// charges in force as of the date it asked about, so a schedule as of the date of death still nets a
// lien discharged the following spring.

export interface EncumbranceEquityLine {
  readonly encumbranceId: string;
  readonly kind: string;
  readonly holderEntityId: string | null;
  readonly holderName: string | null;
  readonly releasedOn: string | null;
  // The balance as of the requested date, with the date it actually speaks to — or undefined where no
  // balance was ever recorded at or before it, which reports as unstated rather than as zero. A charge
  // with no balance is a charge whose size nobody has written down, and treating that as nil would
  // overstate the equity of exactly the assets a firm most needs to be careful about.
  readonly balance: ResolvedEncumbranceBalance | undefined;
}

export interface MatterAssetEquity {
  readonly value: ResolvedMatterAssetValue | undefined;
  readonly encumbrances: readonly EncumbranceEquityLine[];
  // The equity, in the value's currency, or undefined when it cannot be stated. Three ways it cannot:
  // the asset has no value at or before the date, an encumbrance in force carries no balance, or a
  // balance is in a different currency from the value.
  readonly equityAmountMinor: number | undefined;
  readonly equityCurrency: string | undefined;
  // Why the equity is unavailable, for the surface that has to say something in the space where a
  // number would go. Undefined when the equity IS available.
  readonly equityUnavailableReason: EquityUnavailableReason | undefined;
}

export type EquityUnavailableReason =
  | "no-value-as-of-date"
  | "value-has-no-amount"
  | "encumbrance-balance-unstated"
  | "mixed-currency";

// The asset's equity as of a date. Pure: it takes the two resolutions the caller already batched and
// does arithmetic on integers. Nothing here reads, and nothing here rounds — minor units subtract
// exactly, which is the whole reason money is stored as integers.
export function matterAssetEquity(
  value: ResolvedMatterAssetValue | undefined,
  encumbrances: readonly MatterAssetEncumbranceRow[],
  balances: ReadonlyMap<string, ResolvedEncumbranceBalance>,
): MatterAssetEquity {
  const lines: EncumbranceEquityLine[] = encumbrances.map((encumbrance) => ({
    encumbranceId: encumbrance.id,
    kind: encumbrance.kind,
    holderEntityId: encumbrance.holder_entity_id,
    holderName: encumbrance.holder_name,
    releasedOn: encumbrance.released_on,
    balance: balances.get(encumbrance.id),
  }));

  const unavailable = (reason: EquityUnavailableReason): MatterAssetEquity => ({
    value,
    encumbrances: lines,
    equityAmountMinor: undefined,
    equityCurrency: undefined,
    equityUnavailableReason: reason,
  });

  if (value === undefined) return unavailable("no-value-as-of-date");
  if (value.amountMinor === null || value.currency === null) {
    // A valuation row may carry a basis and a date with no amount — "an appraisal was ordered" is a
    // real thing to record. There is nothing to subtract from.
    return unavailable("value-has-no-amount");
  }

  let equity = value.amountMinor;
  for (const line of lines) {
    if (line.balance === undefined) return unavailable("encumbrance-balance-unstated");
    if (line.balance.amountMinor === null || line.balance.currency === null) {
      return unavailable("encumbrance-balance-unstated");
    }
    if (line.balance.currency !== value.currency) return unavailable("mixed-currency");
    equity -= line.balance.amountMinor;
  }

  // Negative equity is a REAL and reportable answer — a house worth less than the mortgage on it is
  // the ordinary condition of a great many estates, and clamping it at zero would hide the fact the
  // schedule exists to surface.
  return {
    value,
    encumbrances: lines,
    equityAmountMinor: equity,
    equityCurrency: value.currency,
    equityUnavailableReason: undefined,
  };
}

// The charges in force as of a date: unreleased, or released only after it. A row released on the
// date itself is treated as released — a discharge recorded on a day is a fact about that day.
export function encumbrancesInForceAsOf(
  encumbrances: readonly MatterAssetEncumbranceRow[],
  asOfDate: string,
): MatterAssetEncumbranceRow[] {
  return encumbrances.filter(
    (encumbrance) => encumbrance.released_on === null || encumbrance.released_on > asOfDate,
  );
}
