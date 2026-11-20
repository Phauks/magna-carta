/*
 * The Banking screen's own decisions, held without a browser.
 *
 *   - THE COLUMN GROUPS BY THE BOOKS. Operating, then Trust, then the bank accounts the firm chose
 *     not to use; an empty group is not drawn.
 *   - SELECTION SURVIVES ONLY WHAT EXISTS. An account the address names is kept while it is there,
 *     else the first account down the column.
 *   - THE BADGE SAYS THE MOST URGENT THING. Sign in again, then how far apart, then when it was read.
 *   - THE FILTER COUNTS ARE THE LINES'. Pending shows only under All.
 *   - THE CONNECT WINDOW GUESSES BY THE LAST FOUR DIGITS, and never onto an account another bank
 *     account already holds.
 */
import { describe, expect, it } from "vitest";
import type {
  BankBookAccount,
  BankConnection,
  BankFeedAccount,
  BankFeedTransaction,
} from "@magna-carta/api-client";
import {
  DONT_USE,
  accountBooksLine,
  apartMinor,
  bankLogoSource,
  booksEntryRoute,
  cardBadge,
  choicesRefusal,
  filterLines,
  groupAccounts,
  lastFourDigits,
  lineCounts,
  linkChanges,
  preselectedBookAccount,
  selectedAccountId,
} from "../src/lib/banking/banking-model.ts";

const book = (
  ledgerAccountId: string,
  name: string,
  kind: "operating" | "trust",
  feedAccountId: string | null = null,
): BankBookAccount => ({
  ledgerAccountId,
  name,
  kind,
  trustAccountId: kind === "trust" ? `trust_${ledgerAccountId}` : null,
  feedAccountId,
});

const account = (
  id: string,
  bookAccount: BankBookAccount | null,
  overrides: Partial<BankFeedAccount> = {},
): BankFeedAccount => ({
  id,
  connectionId: "connection_one",
  institutionName: "Cumberland Bank",
  institutionLogo: null,
  name: "Business Checking",
  mask: "4417",
  subtype: "checking",
  currency: "USD",
  bankBalanceMinor: 100_00,
  availableBalanceMinor: 100_00,
  balanceAsOf: "2026-11-20T22:14:00.000Z",
  bookAccount,
  booksBalanceMinor: bookAccount === null ? null : 100_00,
  notInBooksCount: 0,
  ...overrides,
});

const connection = (overrides: Partial<BankConnection> = {}): BankConnection => ({
  id: "connection_one",
  institutionName: "Cumberland Bank",
  institutionLogo: null,
  signInNeeded: false,
  connectedAt: "2026-11-20T21:00:00.000Z",
  connectedBy: "Trevor Goldsmith",
  lastSyncedAt: "2026-11-20T22:14:00.000Z",
  ...overrides,
});

const line = (
  id: string,
  status: BankFeedTransaction["status"],
  amountMinor = -1_00,
): BankFeedTransaction => ({
  id,
  postedOn: "2026-11-19",
  description: "A LINE",
  amountMinor,
  checkNumber: null,
  status,
});

const READING = {
  now: new Date("2026-11-20T23:00:00.000Z"),
  timeZone: "America/Los_Angeles",
};

describe("groupAccounts", () => {
  it("groups Operating, then Trust, then Not Used, leaving out an empty group", () => {
    const trust = account("trust", book("ledger_trust", "Trust IOLTA", "trust"));
    const unused = account("card", null);
    const operating = account("operating", book("ledger_operating", "Operating", "operating"));
    const groups = groupAccounts([trust, unused, operating]);
    expect(groups.map((group) => group.label)).toEqual(["Operating", "Trust", "Not Used"]);
    expect(groupAccounts([trust]).map((group) => group.kind)).toEqual(["trust"]);
  });
});

describe("selectedAccountId", () => {
  const trust = account("trust", book("ledger_trust", "Trust IOLTA", "trust"));
  const operating = account("operating", book("ledger_operating", "Operating", "operating"));

  it("keeps the account asked for while it exists", () => {
    expect(selectedAccountId([operating, trust], "trust")).toBe("trust");
  });

  it("falls back to the first account down the column, not the first the server sent", () => {
    expect(selectedAccountId([trust, operating], "gone")).toBe("operating");
    expect(selectedAccountId([trust, operating], null)).toBe("operating");
  });

  it("selects nothing when there is nothing", () => {
    expect(selectedAccountId([], "trust")).toBeNull();
  });
});

describe("cardBadge", () => {
  const tied = book("ledger_trust", "Trust IOLTA", "trust");

  it("asks for a new sign-in before anything else", () => {
    const apart = account("a", tied, { bankBalanceMinor: 500_00, booksBalanceMinor: 400_00 });
    expect(cardBadge(apart, connection({ signInNeeded: true }), READING)).toEqual({
      tone: "warning",
      text: "Sign in again",
    });
  });

  it("states how far apart the bank and the books are, whichever is higher", () => {
    const apart = account("a", tied, {
      bankBalanceMinor: 399_905_12,
      booksBalanceMinor: 398_655_12,
    });
    expect(apartMinor(apart)).toBe(1_250_00);
    expect(cardBadge(apart, connection(), READING)?.tone).toBe("danger");
    expect(cardBadge(apart, connection(), READING)?.text).toContain("1,250.00 apart");
    const under = account("b", tied, { bankBalanceMinor: 100_00, booksBalanceMinor: 150_00 });
    expect(apartMinor(under)).toBe(50_00);
  });

  it("shows the time when it was read today, and the date when it was not", () => {
    expect(cardBadge(account("a", tied), connection(), READING)).toEqual({
      tone: "success",
      text: "2:14 PM",
    });
    const older = connection({ lastSyncedAt: "2026-11-12T16:30:00.000Z" });
    expect(cardBadge(account("a", tied), older, READING)?.text).toBe("Nov 12, 2026");
  });

  it("never compares an untied account with the books", () => {
    expect(apartMinor(account("card", null))).toBeNull();
    expect(accountBooksLine(account("card", null))).toBe("Not used in the books");
  });
});

describe("lineCounts and filterLines", () => {
  const lines = [
    line("one", "notInBooks"),
    line("two", "notInBooks"),
    line("three", "inBooks"),
    line("four", "pending"),
  ];

  it("counts each status, and All counts everything", () => {
    expect(lineCounts(lines)).toEqual({ notInBooks: 2, inBooks: 1, all: 4 });
  });

  it("shows Pending only under All", () => {
    expect(filterLines(lines, "notInBooks").map((one) => one.id)).toEqual(["one", "two"]);
    expect(filterLines(lines, "inBooks").map((one) => one.id)).toEqual(["three"]);
    expect(filterLines(lines, "all")).toHaveLength(4);
  });
});

describe("preselectedBookAccount", () => {
  const books = [
    book("ledger_operating", "Operating 4417", "operating"),
    book("ledger_payroll", "Payroll", "operating"),
    book("ledger_held", "Reserve 5502", "operating", "someone_else"),
  ];

  it("reads the last four digits of a name, and nothing from a shorter run", () => {
    expect(lastFourDigits("Operating 4417")).toBe("4417");
    expect(lastFourDigits("Account 12-34-4417")).toBe("4417");
    expect(lastFourDigits("Suite 12")).toBeNull();
  });

  it("starts on the account already tied", () => {
    const tied = account("a", books[1] ?? null);
    expect(preselectedBookAccount(tied, books)).toBe("ledger_payroll");
  });

  it("starts on the account whose name ends in the bank's last four digits", () => {
    expect(preselectedBookAccount(account("a", null, { mask: "4417" }), books)).toBe(
      "ledger_operating",
    );
  });

  it("starts on Don't Use where nothing matches or the match is taken", () => {
    expect(preselectedBookAccount(account("a", null, { mask: "9999" }), books)).toBe(DONT_USE);
    expect(preselectedBookAccount(account("a", null, { mask: "5502" }), books)).toBe(DONT_USE);
    expect(preselectedBookAccount(account("a", null, { mask: null }), books)).toBe(DONT_USE);
  });
});

describe("linkChanges and choicesRefusal", () => {
  const operating = book("ledger_operating", "Operating", "operating", "a");
  const payroll = book("ledger_payroll", "Payroll", "operating");
  const held = book("ledger_held", "Held", "operating", "outside");
  const accounts = [account("a", operating), account("b", null)];

  it("writes only what changed, unties first", () => {
    const changes = linkChanges(accounts, [
      { accountId: "a", ledgerAccountId: DONT_USE },
      { accountId: "b", ledgerAccountId: "ledger_operating" },
    ]);
    expect(changes).toEqual([
      { accountId: "a", ledgerAccountId: null },
      { accountId: "b", ledgerAccountId: "ledger_operating" },
    ]);
    expect(
      linkChanges(accounts, [{ accountId: "a", ledgerAccountId: "ledger_operating" }]),
    ).toEqual([]);
  });

  it("refuses one account in the books chosen twice, or held by a bank account elsewhere", () => {
    const books = [operating, payroll, held];
    expect(
      choicesRefusal(
        [
          { accountId: "a", ledgerAccountId: "ledger_payroll" },
          { accountId: "b", ledgerAccountId: "ledger_payroll" },
        ],
        books,
      ),
    ).toBe("Payroll is chosen twice.");
    expect(choicesRefusal([{ accountId: "b", ledgerAccountId: "ledger_held" }], books)).toBe(
      "Held is already used by another bank account.",
    );
    // Held by a bank account in this same window, which is giving it up: allowed.
    expect(
      choicesRefusal(
        [
          { accountId: "a", ledgerAccountId: DONT_USE },
          { accountId: "b", ledgerAccountId: "ledger_operating" },
        ],
        books,
      ),
    ).toBeUndefined();
  });
});

describe("booksEntryRoute", () => {
  it("sends a trust line to the Trust screen on that account, and says operating is not built", () => {
    expect(booksEntryRoute(account("t", book("iolta", "Trust IOLTA", "trust")))).toEqual({
      kind: "trust",
      href: "/trust?account=trust_iolta",
    });
    expect(booksEntryRoute(account("o", book("op", "Operating", "operating")))).toEqual({
      kind: "operating",
    });
    expect(booksEntryRoute(account("u", null))).toEqual({ kind: "untied" });
  });
});

describe("bankLogoSource", () => {
  it("turns the feed's bare base64 PNG into an image address, and none into null", () => {
    expect(bankLogoSource("iVBORw0KGgo=")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(bankLogoSource(null)).toBeNull();
    expect(bankLogoSource("  ")).toBeNull();
  });
});
