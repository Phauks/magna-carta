/*
 * The firm's trust-account register, as columns. What is worth a test here is the register's
 * honesty about the two facts an account can be missing.
 *
 *   - AN OFFICE IS A NAME AND SOMETIMES ONLY A HANDLE. The listing serves an identifier and the
 *     firm's office roster turns it into a name; where the roster cannot, the identifier stands on
 *     the row rather than the cell going blank, because a blank would read as an account bound to
 *     no office at all — which is not a state the contract can even be in.
 *   - A MISSING JURISDICTION IS A VALUE. An account whose holding office records none refuses every
 *     movement until it does, so it is a state a reader narrows TO. Leaving the cell empty would
 *     put the most consequential question the register answers out of the filter's reach.
 *
 * The declared vocabularies are pinned too: a firm with nothing closed today can still hold a
 * closed account, and a Status filter that dropped "Closed" because none is loaded would tell that
 * firm it cannot have one.
 */
import { describe, expect, it } from "vitest";
import type { TrustAccountListing } from "../src/lib/trust/trust-api.ts";
import {
  FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS,
  FIRM_TRUST_ACCOUNT_INITIAL_SORT,
  IOLTA_FILTER_VALUES,
  STANDING_FILTER_VALUES,
  firmTrustAccountColumns,
  jurisdictionCellText,
  officeCellText,
} from "../src/lib/trust/firm-trust-columns.ts";

function account(overrides: Partial<TrustAccountListing> = {}): TrustAccountListing {
  return {
    id: "trustAccount_one",
    name: "Operating Trust",
    locationId: "location_one",
    jurisdiction: "NY",
    bankName: "First National",
    accountNumberLastFour: "4417",
    currency: "USD",
    iolta: true,
    status: "open",
    openedOn: "2026-01-05",
    closedAt: null,
    timeZone: "America/New_York",
    ...overrides,
  };
}

const OFFICES: Readonly<Record<string, string>> = { location_one: "Manhattan" };
const officeName = (locationId: string): string | null => OFFICES[locationId] ?? null;

const columns = firmTrustAccountColumns({ officeName, officeNames: ["Manhattan", "Brooklyn"] });
const column = (id: string) => {
  const found = columns.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no column ${id}`);
  return found;
};

describe("the firm's trust-account columns", () => {
  it("anchors the name and opens in name order, because a roster is read down", () => {
    expect(column(FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.name).anchored).toBe(true);
    expect(FIRM_TRUST_ACCOUNT_INITIAL_SORT).toEqual({ columnId: "name", direction: "ascending" });
  });

  it("declares every column the row can answer, and shows the ones a reader opens for", () => {
    expect(columns.map((entry) => entry.id)).toEqual([
      "name",
      "bankName",
      "accountNumberLastFour",
      "office",
      "jurisdiction",
      "iolta",
      "standing",
      "openedOn",
      "closedAt",
    ]);
    // Almost every account on a working firm is open, so a column of empty closing dates would take
    // width from the columns that answer something. It is one press away in the header's menu.
    expect(column(FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.closedAt).hidden).toBe(true);
    expect(column(FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.openedOn).hidden).toBeUndefined();
  });

  it("names the office rather than its handle, and keeps the handle when it cannot", () => {
    expect(officeCellText(account(), officeName)).toBe("Manhattan");
    expect(officeCellText(account({ locationId: "location_gone" }), officeName)).toBe(
      "location_gone",
    );
    expect(column(FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.office).value(account())).toBe("Manhattan");
  });

  it("makes a missing jurisdiction a value a reader can narrow to, not a blank cell", () => {
    expect(jurisdictionCellText(account())).toBe("NY");
    expect(jurisdictionCellText(account({ jurisdiction: null }))).toBe("Not recorded");
    expect(
      column(FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.jurisdiction).value(
        account({ jurisdiction: null }),
      ),
    ).toBe("Not recorded");
    expect(column(FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.jurisdiction).filter).toBe("set");
  });

  it("offers both answers on the declared vocabularies, whatever the firm happens to hold today", () => {
    expect(column(FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.iolta).filterValues).toEqual(
      IOLTA_FILTER_VALUES,
    );
    expect(column(FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.standing).filterValues).toEqual(
      STANDING_FILTER_VALUES,
    );
    expect(IOLTA_FILTER_VALUES).toEqual(["Yes", "No"]);
    expect(STANDING_FILTER_VALUES).toEqual(["Open", "Closed"]);
    // The office filter offers every office the firm holds, including one no account sits at yet.
    expect(column(FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.office).filterValues).toEqual([
      "Manhattan",
      "Brooklyn",
    ]);
  });

  it("reads the two words the register speaks off the account itself", () => {
    expect(column(FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.standing).value(account())).toBe("Open");
    expect(
      column(FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.standing).value(account({ status: "closed" })),
    ).toBe("Closed");
    expect(column(FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.iolta).value(account())).toBe("Yes");
    expect(
      column(FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.iolta).value(account({ iolta: false })),
    ).toBe("No");
  });

  it("leaves an unrecorded bank and an unrecorded last four empty rather than inventing a word", () => {
    const bare = account({ bankName: null, accountNumberLastFour: null });
    expect(column(FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.bankName).text?.(bare)).toBe("");
    expect(column(FIRM_TRUST_ACCOUNT_COLUMN_IDENTIFIERS.accountNumberLastFour).text?.(bare)).toBe(
      "",
    );
  });

  it("carries no balance column, because no route states one", () => {
    // The panel says where the figure would be. A column of dashes across the register would be a
    // row of questions rather than an answer, and a balance summed from reconciliations would be a
    // figure about client money that nothing ever stated.
    expect(columns.some((entry) => entry.id.toLowerCase().includes("balance"))).toBe(false);
  });
});
