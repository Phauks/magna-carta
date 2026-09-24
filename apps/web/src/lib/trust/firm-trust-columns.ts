/*
 * The firm's trust accounts, as columns: what an account says about itself, declared once.
 *
 * The grid is the product's one table, so nothing about sorting, filtering, hiding, reordering,
 * pinning or resizing is decided here. This file says only WHAT the columns are: their words, their
 * value types, and which of them a reader narrows from.
 *
 * THE NAME LEADS AND IS ANCHORED, because a trust account is referred to by its name in every
 * conversation a firm has about it. Everything else on the row is what tells two accounts apart
 * when the names are close: which bank, which four digits, which office, which jurisdiction.
 *
 * THE OFFICE IS A NAME, NOT A HANDLE. The listing serves the office's identifier, and the firm's own
 * office roster is what turns it into a name. The resolver is handed in rather than read here, so
 * this module stays pure and the roster is read once for the whole screen; an identifier the roster
 * cannot resolve stays on the row and says why on its hover, because a blank cell would read as an
 * account bound to nothing.
 *
 * A MISSING JURISDICTION IS A VALUE, NOT AN ABSENCE. An account whose holding office records no
 * jurisdiction refuses every movement until it does, so "Not recorded" is a state a reader wants to
 * narrow to — it is the list of accounts that cannot be used. Leaving the cell empty would put that
 * question out of the filter's reach.
 *
 * NO BALANCE COLUMN. Nothing serves an account's balance as it stands today, and a column of
 * dashes across the register would be a row of questions rather than an answer. What the screen
 * does instead is say so once, in the panel, where the figure would be read.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import type { TrustAccountListing } from "./trust-api.ts";
import {
  JURISDICTION_NOT_RECORDED,
  accountStandingLabel,
  ioltaLabel,
} from "./firm-trust-vocabulary.ts";

/** Column ids, spelled in full, so a test and a stored layout name the same thing as the code. */
export const FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS = {
  name: "name",
  bankName: "bankName",
  accountNumberLastFour: "accountNumberLastFour",
  office: "office",
  jurisdiction: "jurisdiction",
  iolta: "iolta",
  standing: "standing",
  openedOn: "openedOn",
  closedAt: "closedAt",
} as const;

/** The register opens in name order: a roster is read down, not scanned for the newest. */
export const FIRM_TRUST_ACCOUNT_INITIAL_SORT = {
  columnId: FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.name,
  direction: "ascending",
} as const;

/** The two answers the IOLTA filter offers, whether or not the firm holds one of each today. */
export const IOLTA_FILTER_VALUES: readonly string[] = ["Yes", "No"];

/** The two standings an account can be in, so a firm with nothing closed can still ask for closed. */
export const STANDING_FILTER_VALUES: readonly string[] = ["Open", "Closed"];

export interface FirmTrustAccountColumnOptions {
  /** The office's own name for a location identifier, or null where the roster does not hold it. */
  readonly officeName: (locationId: string) => string | null;
  /** Every office the firm holds, so the Office filter offers one a reader has no account at yet. */
  readonly officeNames: readonly string[];
}

/** What the Office cell reads: the office's name, or the identifier the listing served. */
export function officeCellText(
  account: TrustAccountListing,
  officeName: (locationId: string) => string | null,
): string {
  return officeName(account.locationId) ?? account.locationId;
}

/** What the Jurisdiction cell reads: the jurisdiction, or the fact that the office records none. */
export function jurisdictionCellText(account: TrustAccountListing): string {
  return account.jurisdiction ?? JURISDICTION_NOT_RECORDED;
}

/** The register's columns, in the order the design puts them. */
export function firmTrustAccountColumns(
  options: FirmTrustAccountColumnOptions,
): readonly GridColumn<TrustAccountListing>[] {
  return [
    {
      id: FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.name,
      label: "Name",
      type: "text",
      anchored: true,
      value: (account) => account.name,
    },
    {
      id: FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.bankName,
      label: "Bank",
      type: "text",
      filter: "set",
      value: (account) => account.bankName,
      text: (account) => account.bankName ?? "",
    },
    {
      id: FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.accountNumberLastFour,
      label: "Ending",
      type: "text",
      value: (account) => account.accountNumberLastFour,
      text: (account) => account.accountNumberLastFour ?? "",
    },
    {
      id: FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.office,
      label: "Office",
      type: "text",
      filter: "set",
      filterValues: options.officeNames,
      value: (account) => officeCellText(account, options.officeName),
    },
    {
      id: FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.jurisdiction,
      label: "Jurisdiction",
      type: "text",
      filter: "set",
      value: (account) => jurisdictionCellText(account),
    },
    {
      id: FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.iolta,
      label: "IOLTA",
      type: "text",
      filter: "set",
      filterValues: IOLTA_FILTER_VALUES,
      value: (account) => ioltaLabel(account.iolta),
    },
    {
      id: FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.standing,
      label: "Status",
      type: "text",
      filter: "set",
      filterValues: STANDING_FILTER_VALUES,
      fitExtra: 12,
      value: (account) => accountStandingLabel(account.status),
    },
    {
      id: FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.openedOn,
      label: "Opened",
      type: "date",
      value: (account) => account.openedOn,
    },
    {
      /*
       * Hidden by default: on a working firm almost every account is open, so a column of empty
       * cells would take width from the ones that answer something. It is one press away in the
       * header menu's Columns submenu, which is where a reader looking for a closed account's date
       * already goes.
       */
      id: FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.closedAt,
      label: "Closed",
      type: "date",
      hidden: true,
      value: (account) => account.closedAt,
    },
  ];
}
