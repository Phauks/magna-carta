/*
 * The Banking screen over fixtures, for the developer-console gallery. A local firm has no bank
 * feed keys, so this is where the screen is reviewed: the board's own accounts (Operating, Payroll,
 * a trust account $1,250.00 apart from its books, an estate account whose bank wants a new sign-in)
 * and a credit card the firm chose not to use. The service keeps the writes in memory, so tying,
 * disconnecting and connecting all move the screen. Reload to start again.
 */
import { addCalendarDays } from "@magna-carta/civil-time/civil-date";
import type { ApiOutcome } from "$lib/api/request.ts";
import { transportOutcome } from "$lib/api/request.ts";
import type {
  BankBookAccount,
  BankConnection,
  BankFeedAccount,
  BankFeedTransaction,
  BankFeedTransactionsResponse,
  BankingOverviewResponse,
} from "./banking-api.ts";
import type { BankingService } from "./banking-service.ts";

export const BANKING_GALLERY_STATES = [
  "working",
  "empty",
  "unconfigured",
  "loading",
  "failed",
] as const;
export type BankingGalleryState = (typeof BANKING_GALLERY_STATES)[number];

/** The moment the gallery treats as now: 3:00 PM in Los Angeles on Nov 20, 2026. */
export const GALLERY_NOW = new Date("2026-11-20T23:00:00.000Z");
export const GALLERY_TIME_ZONE = "America/Los_Angeles";

export const GALLERY_CUMBERLAND = "bank_connection_gallery_cumberland";
export const GALLERY_RIVERSIDE = "bank_connection_gallery_riverside";
export const GALLERY_OPERATING_ACCOUNT = "bank_feed_account_gallery_4417";
export const GALLERY_TRUST_ACCOUNT = "bank_feed_account_gallery_7730";
/** The Helcim deposit on Operating, which the gallery opens Add to Books on. */
export const GALLERY_HELCIM_LINE = "bank_line_gallery_helcim";

const SYNCED = "2026-11-20T22:14:00.000Z";

/**
 * A made-up bank mark (a plain columned building, 40 by 40), standing in for the logo the bank feed
 * sends as a base64 PNG. Riverside Savings has none, so the gallery shows the initials too.
 */
const GALLERY_LOGO =
  "iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAIAAAADnC86AAAAQklEQVR42u3WsQkAMAgEQDdxlYyT/ReIA6QLQhDusfrmLD9y7S8XYDAY3A6fpsyB7yeeSzAYDAaDwRaIlQkGg6fDBUqMhJtN84aCAAAAAElFTkSuQmCC";

const CONNECTIONS: readonly BankConnection[] = [
  {
    id: GALLERY_CUMBERLAND,
    institutionName: "Cumberland Bank",
    institutionLogo: GALLERY_LOGO,
    signInNeeded: false,
    connectedAt: "2026-11-20T21:50:00.000Z",
    connectedBy: "Trevor Goldsmith",
    lastSyncedAt: SYNCED,
  },
  {
    id: GALLERY_RIVERSIDE,
    institutionName: "Riverside Savings",
    institutionLogo: null,
    signInNeeded: true,
    connectedAt: "2026-10-02T17:05:00.000Z",
    connectedBy: "Trevor Goldsmith",
    lastSyncedAt: "2026-11-12T16:30:00.000Z",
  },
];

const BOOK_ACCOUNTS: readonly BankBookAccount[] = [
  {
    ledgerAccountId: "ledger_gallery_operating",
    name: "Operating",
    kind: "operating",
    trustAccountId: null,
    feedAccountId: GALLERY_OPERATING_ACCOUNT,
  },
  {
    ledgerAccountId: "ledger_gallery_payroll",
    name: "Payroll",
    kind: "operating",
    trustAccountId: null,
    feedAccountId: "bank_feed_account_gallery_4425",
  },
  {
    ledgerAccountId: "ledger_gallery_iolta",
    name: "Trust IOLTA",
    kind: "trust",
    trustAccountId: "trust_account_gallery_iolta",
    feedAccountId: GALLERY_TRUST_ACCOUNT,
  },
  {
    ledgerAccountId: "ledger_gallery_hale",
    name: "Trust, Estate of Hale",
    kind: "trust",
    trustAccountId: "trust_account_gallery_hale",
    feedAccountId: "bank_feed_account_gallery_5502",
  },
  {
    ledgerAccountId: "ledger_gallery_tax_reserve",
    name: "Tax Reserve 0921",
    kind: "operating",
    trustAccountId: null,
    feedAccountId: null,
  },
];

function feedAccount(
  id: string,
  connectionId: string,
  name: string,
  mask: string,
  bankMinor: number,
  ledgerAccountId: string | null,
  booksMinor: number | null,
  notInBooks: number,
): BankFeedAccount {
  const connection = CONNECTIONS.find((one) => one.id === connectionId);
  const book = BOOK_ACCOUNTS.find((one) => one.ledgerAccountId === ledgerAccountId) ?? null;
  return {
    id,
    connectionId,
    institutionName: connection?.institutionName ?? "",
    institutionLogo: connection?.institutionLogo ?? null,
    name,
    mask,
    subtype: "checking",
    currency: "USD",
    bankBalanceMinor: bankMinor,
    availableBalanceMinor: bankMinor,
    balanceAsOf: connection?.lastSyncedAt ?? null,
    bookAccount: book,
    booksBalanceMinor: book === null ? null : booksMinor,
    notInBooksCount: notInBooks,
  };
}

const ACCOUNTS: readonly BankFeedAccount[] = [
  feedAccount(
    GALLERY_OPERATING_ACCOUNT,
    GALLERY_CUMBERLAND,
    "Business Checking",
    "4417",
    6_188_012,
    "ledger_gallery_operating",
    6_188_012,
    3,
  ),
  feedAccount(
    "bank_feed_account_gallery_4425",
    GALLERY_CUMBERLAND,
    "Business Checking",
    "4425",
    1_440_225,
    "ledger_gallery_payroll",
    1_440_225,
    0,
  ),
  feedAccount(
    GALLERY_TRUST_ACCOUNT,
    GALLERY_CUMBERLAND,
    "IOLTA Checking",
    "7730",
    39_990_512,
    "ledger_gallery_iolta",
    39_865_512,
    1,
  ),
  feedAccount(
    "bank_feed_account_gallery_1009",
    GALLERY_CUMBERLAND,
    "Business Credit Card",
    "1009",
    231_640,
    null,
    null,
    0,
  ),
  feedAccount(
    "bank_feed_account_gallery_5502",
    GALLERY_RIVERSIDE,
    "Estate Savings",
    "5502",
    1_300_000,
    "ledger_gallery_hale",
    1_300_000,
    0,
  ),
];

const PAYEES = [
  "CLIENT PAYMENT ACH",
  "ADP PAYROLL",
  "COUNTY RECORDER FILING",
  "OFFICE DEPOT",
  "PACER SERVICE CENTER",
  "LEXISNEXIS",
  "CITY WATER UTILITY",
];

/** A day `back` days before Nov 20, 2026, as YYYY-MM-DD. */
function dayBefore(back: number): string {
  return addCalendarDays("2026-11-20", -back);
}

function linesFor(accountId: string): readonly BankFeedTransaction[] {
  if (accountId === GALLERY_OPERATING_ACCOUNT) {
    const open: BankFeedTransaction[] = [
      {
        id: "bank_line_gallery_pending",
        postedOn: dayBefore(0),
        description: "PACER SERVICE CENTER",
        amountMinor: -6_480,
        checkNumber: null,
        status: "pending",
      },
      {
        id: "bank_line_gallery_westlaw",
        postedOn: "2026-11-19",
        description: "WESTLAW THOMSON REUTERS ACH",
        amountMinor: -41_200,
        checkNumber: null,
        status: "notInBooks",
      },
      {
        id: "bank_line_gallery_charge",
        postedOn: "2026-11-18",
        description: "CUMBERLAND BANK SERVICE CHARGE",
        amountMinor: -2_500,
        checkNumber: null,
        status: "notInBooks",
      },
      {
        id: GALLERY_HELCIM_LINE,
        postedOn: "2026-11-17",
        description: "HELCIM DEPOSIT 8812",
        amountMinor: 318_000,
        checkNumber: null,
        status: "notInBooks",
      },
    ];
    const cleared = Array.from({ length: 41 }, (_, index): BankFeedTransaction => ({
      id: `bank_line_gallery_operating_${index}`,
      postedOn: dayBefore(4 + index * 2),
      description: PAYEES[index % PAYEES.length] ?? "",
      amountMinor: index % 3 === 0 ? 125_000 + index * 1_000 : -(8_000 + index * 375),
      checkNumber: index % 5 === 1 ? String(1040 + index) : null,
      status: "inBooks",
    }));
    return [...open, ...cleared];
  }
  if (accountId === GALLERY_TRUST_ACCOUNT) {
    return [
      {
        id: "bank_line_gallery_trust_deposit",
        postedOn: "2026-11-18",
        description: "DEPOSIT CHECK 2214",
        amountMinor: 125_000,
        checkNumber: "2214",
        status: "notInBooks",
      },
      {
        id: "bank_line_gallery_trust_wire",
        postedOn: "2026-11-10",
        description: "WIRE TO MERIDIAN TITLE",
        amountMinor: -4_500_000,
        checkNumber: null,
        status: "inBooks",
      },
      {
        id: "bank_line_gallery_trust_retainer",
        postedOn: "2026-11-03",
        description: "CLIENT RETAINER ACH",
        amountMinor: 1_000_000,
        checkNumber: null,
        status: "inBooks",
      },
    ];
  }
  return [
    {
      id: `${accountId}_line_0`,
      postedOn: "2026-11-02",
      description: "INTEREST PAYMENT",
      amountMinor: 1_084,
      checkNumber: null,
      status: "inBooks",
    },
  ];
}

const ok = <T>(value: T): Promise<ApiOutcome<T>> => Promise.resolve({ kind: "ok", value });

const never = (): Promise<never> => new Promise(() => {});
const failing = <T>(): Promise<ApiOutcome<T>> =>
  Promise.resolve(transportOutcome<T>("GET /api/v1/banking"));

export function galleryBankingService(state: BankingGalleryState): BankingService {
  let accounts: BankFeedAccount[] =
    state === "empty" || state === "unconfigured" ? [] : structuredClone([...ACCOUNTS]);
  let connections: BankConnection[] =
    state === "empty" || state === "unconfigured" ? [] : structuredClone([...CONNECTIONS]);
  let bookAccounts: BankBookAccount[] = structuredClone([...BOOK_ACCOUNTS]);

  const tie = (accountId: string, ledgerAccountId: string | null): void => {
    bookAccounts = bookAccounts.map((book) => ({
      ...book,
      feedAccountId:
        book.ledgerAccountId === ledgerAccountId
          ? accountId
          : book.feedAccountId === accountId
            ? null
            : book.feedAccountId,
    }));
    accounts = accounts.map((account) => {
      if (account.id !== accountId) return account;
      const book = bookAccounts.find((one) => one.ledgerAccountId === ledgerAccountId) ?? null;
      return {
        ...account,
        bookAccount: book,
        booksBalanceMinor: book === null ? null : account.bankBalanceMinor,
      };
    });
  };

  return {
    readOverview: (): Promise<ApiOutcome<BankingOverviewResponse>> => {
      if (state === "loading") return never();
      if (state === "failed") return failing();
      return ok({
        providerConfigured: state !== "unconfigured",
        connections: structuredClone(connections),
        accounts: structuredClone(accounts),
        bookAccounts: structuredClone(bookAccounts),
      });
    },
    readTransactions: (accountId): Promise<ApiOutcome<BankFeedTransactionsResponse>> =>
      ok({
        accountId,
        from: "2026-08-22",
        to: "2026-11-20",
        transactions: [...linesFor(accountId)],
      }),
    readSignInToken: () =>
      ok({ token: "link-sandbox-gallery", expiresAt: "2026-11-20T23:30:00.000Z" }),
    connect: () => {
      // The gallery's new bank is Cumberland again, its accounts untied, as a fresh connection is.
      for (const account of accounts) {
        if (account.connectionId === GALLERY_CUMBERLAND) tie(account.id, null);
      }
      return ok({ connectionId: GALLERY_CUMBERLAND });
    },
    link: (accountId, ledgerAccountId) => {
      tie(accountId, ledgerAccountId);
      return ok(null);
    },
    disconnect: (connectionId) => {
      for (const account of accounts) {
        if (account.connectionId === connectionId) tie(account.id, null);
      }
      connections = connections.filter((connection) => connection.id !== connectionId);
      accounts = accounts.filter((account) => account.connectionId !== connectionId);
      return ok(null);
    },
    openSignIn: () =>
      Promise.resolve({
        kind: "signedIn",
        success: { publicToken: "public-sandbox-gallery", institutionName: "Cumberland Bank" },
      }),
  };
}
