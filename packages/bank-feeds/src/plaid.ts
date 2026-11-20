/*
 * The Plaid adapter behind BankFeedPort, over Plaid's JSON API with `fetch` (no SDK: Plaid's own
 * client brings an HTTP stack a Worker does not need).
 *
 * WHAT IT ASKS FOR. The Transactions product only, which also carries each account's balance. No
 * Auth (account and routing numbers), no Transfer, no Identity: the firm's bank feed reads, it never
 * pays. The sign-in window is limited to checking and savings accounts, because a feed exists to be
 * set beside a bank account in the books.
 *
 * WHAT IT NEVER DOES. The client id and secret ride in the JSON body, as Plaid's API takes them,
 * never in a URL. An access token is never logged and never echoed: a failure says which of four
 * reasons it was and at most Plaid's error code.
 *
 * SIGN CONVENTION. Plaid reports a transaction amount as positive when money LEAVES the account. The
 * port speaks the firm's way round (positive is money in), so every amount is negated here and
 * nowhere else.
 */
import { isCivilDate } from "@magna-carta/civil-time/civil-date";
import {
  bankFeedFailure,
  decimalToMinor,
  type BankFeedFailure,
  type BankFeedPort,
  type BankFeedResult,
  type ReportedAccount,
  type ReportedTransaction,
} from "./port.ts";

export type PlaidEnvironment = "sandbox" | "production";

const HOSTS: Record<PlaidEnvironment, string> = {
  sandbox: "https://sandbox.plaid.com",
  production: "https://production.plaid.com",
};

/** The name Plaid's sign-in window shows the person signing in. Plaid caps it at 30 characters. */
export const PLAID_CLIENT_NAME = "Magna Carta";

/** The most transactions Plaid returns in one page of /transactions/sync. */
const PAGE_SIZE = 500;

/** A sync that has not finished after this many pages is cut off and resumed on the next one. */
const MOST_PAGES_PER_SYNC = 20;

export interface PlaidCredentials {
  readonly clientId: string;
  readonly secret: string;
  readonly environment: PlaidEnvironment;
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

interface PlaidError {
  readonly error_type?: string;
  readonly error_code?: string;
}

// Plaid error codes that mean "the bank wants the firm to sign in again". Everything in the
// ITEM_ERROR family that a person can fix by going through the sign-in window once more.
const SIGN_IN_CODES = new Set([
  "ITEM_LOGIN_REQUIRED",
  "PENDING_EXPIRATION",
  "PENDING_DISCONNECT",
  "ACCESS_NOT_GRANTED",
  "INSUFFICIENT_CREDENTIALS",
  "USER_PERMISSION_REVOKED",
]);

const RETRYABLE_TYPES = new Set(["API_ERROR", "INSTITUTION_ERROR", "RATE_LIMIT_EXCEEDED"]);

function failureFrom(status: number, body: unknown): BankFeedFailure {
  const error = (typeof body === "object" && body !== null ? body : {}) as PlaidError;
  const code = typeof error.error_code === "string" ? error.error_code : null;
  const type = typeof error.error_type === "string" ? error.error_type : null;
  const detail =
    code === null ? `The bank feed answered ${status}.` : `The bank feed answered ${code}.`;
  if (code !== null && SIGN_IN_CODES.has(code)) return bankFeedFailure("sign-in-needed", detail);
  if (status >= 500 || (type !== null && RETRYABLE_TYPES.has(type))) {
    return bankFeedFailure("unavailable", detail);
  }
  return bankFeedFailure("refused", detail);
}

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);
const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const asArray = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

function readAccount(value: unknown): ReportedAccount | null {
  const account = asRecord(value);
  if (account === null) return null;
  const remoteAccountId = asString(account.account_id);
  const name = asString(account.name);
  const kind = asString(account.type);
  if (remoteAccountId === null || name === null || kind === null) return null;
  const balances = asRecord(account.balances) ?? {};
  const current = asNumber(balances.current);
  const available = asNumber(balances.available);
  return {
    remoteAccountId,
    name,
    officialName: asString(account.official_name),
    mask: asString(account.mask),
    kind,
    subtype: asString(account.subtype),
    currency: asString(balances.iso_currency_code) ?? "USD",
    currentBalanceMinor: current === null ? null : decimalToMinor(current),
    availableBalanceMinor: available === null ? null : decimalToMinor(available),
  };
}

function readTransaction(value: unknown): ReportedTransaction | null {
  const transaction = asRecord(value);
  if (transaction === null) return null;
  const remoteTransactionId = asString(transaction.transaction_id);
  const remoteAccountId = asString(transaction.account_id);
  const postedOn = asString(transaction.date);
  const amount = asNumber(transaction.amount);
  if (
    remoteTransactionId === null ||
    remoteAccountId === null ||
    postedOn === null ||
    !isCivilDate(postedOn) ||
    amount === null
  ) {
    return null;
  }
  // What the bank printed. Plaid's `name` is its cleaned-up version, kept only when the bank's own
  // text is absent, because a person matches a line against their statement by what the bank wrote.
  const description =
    asString(transaction.original_description) ??
    asString(transaction.name) ??
    asString(transaction.merchant_name) ??
    "";
  return {
    remoteTransactionId,
    remoteAccountId,
    postedOn,
    description: description.trim().slice(0, 500),
    // Plaid: positive is money out. The firm: positive is money in.
    amountMinor: -decimalToMinor(amount),
    currency: asString(transaction.iso_currency_code) ?? "USD",
    checkNumber: asString(transaction.check_number),
    pending: transaction.pending === true,
  };
}

export function plaidBankFeedPort(
  credentials: PlaidCredentials,
  fetcher: Fetch = fetch,
): BankFeedPort {
  const host = HOSTS[credentials.environment];

  async function call(
    path: string,
    body: Record<string, unknown>,
  ): Promise<BankFeedResult<Record<string, unknown>>> {
    let response: Response;
    try {
      response = await fetcher(`${host}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_id: credentials.clientId,
          secret: credentials.secret,
          ...body,
        }),
      });
    } catch {
      return bankFeedFailure("unavailable", "The bank feed could not be reached.");
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return bankFeedFailure("unavailable", `The bank feed answered ${response.status}.`);
    }
    if (!response.ok) return failureFrom(response.status, parsed);
    const record = asRecord(parsed);
    if (record === null)
      return bankFeedFailure("unavailable", "The bank feed answered nothing readable.");
    return { ok: true, value: record };
  }

  const unreadable = (): BankFeedFailure =>
    bankFeedFailure("unavailable", "The bank feed answered nothing readable.");

  return {
    provider: "plaid",

    async signInToken(input) {
      const body: Record<string, unknown> = {
        client_name: PLAID_CLIENT_NAME,
        language: "en",
        country_codes: ["US"],
        user: { client_user_id: input.clientUserId },
      };
      if (input.accessToken === undefined) {
        body.products = ["transactions"];
        body.account_filters = { depository: { account_subtypes: ["checking", "savings"] } };
      } else {
        // Update mode: the same connection, signed in to again. Plaid takes no products here.
        body.access_token = input.accessToken;
      }
      const answer = await call("/link/token/create", body);
      if (!answer.ok) return answer;
      const token = asString(answer.value.link_token);
      const expiresAt = asString(answer.value.expiration);
      if (token === null || expiresAt === null) return unreadable();
      return { ok: true, value: { token, expiresAt } };
    },

    async exchange(publicToken) {
      const answer = await call("/item/public_token/exchange", { public_token: publicToken });
      if (!answer.ok) return answer;
      const accessToken = asString(answer.value.access_token);
      const remoteItemId = asString(answer.value.item_id);
      if (accessToken === null || remoteItemId === null) return unreadable();
      return { ok: true, value: { accessToken, remoteItemId } };
    },

    async institution(accessToken) {
      const answer = await call("/item/get", { access_token: accessToken });
      if (!answer.ok) return answer;
      const item = asRecord(answer.value.item);
      const name = item === null ? null : asString(item.institution_name);
      const institutionId = item === null ? null : asString(item.institution_id);
      // The logo is a nicety: a failure to read it never fails the connection.
      let logo: string | null = null;
      if (institutionId !== null) {
        const record = await call("/institutions/get_by_id", {
          institution_id: institutionId,
          country_codes: ["US"],
          options: { include_optional_metadata: true },
        });
        if (record.ok) logo = asString(asRecord(record.value.institution)?.logo);
      }
      return { ok: true, value: { name: name ?? "Bank", logo } };
    },

    async accounts(accessToken) {
      // The live balance, not the cached one: /accounts/get refreshes about once a day, and the
      // point of the screen is what the bank holds now. Plaid bills this call, which is why the
      // caller decides how often it runs.
      const answer = await call("/accounts/balance/get", { access_token: accessToken });
      if (!answer.ok) return answer;
      const accounts: ReportedAccount[] = [];
      for (const value of asArray(answer.value.accounts)) {
        const account = readAccount(value);
        if (account !== null) accounts.push(account);
      }
      return { ok: true, value: accounts };
    },

    async transactions(accessToken, cursor) {
      // Pages until Plaid says there is no more. If the bank's data changes between pages Plaid
      // answers TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION, and the whole run starts again from
      // the cursor it began with, as Plaid's documentation directs.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const added: ReportedTransaction[] = [];
        const modified: ReportedTransaction[] = [];
        const removed: string[] = [];
        let next = cursor;
        let restart = false;
        for (let page = 0; page < MOST_PAGES_PER_SYNC; page += 1) {
          const body: Record<string, unknown> = {
            access_token: accessToken,
            count: PAGE_SIZE,
            options: { include_original_description: true },
          };
          if (next !== null) body.cursor = next;
          const answer = await call("/transactions/sync", body);
          if (!answer.ok) {
            if (answer.detail.includes("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION")) {
              restart = true;
              break;
            }
            return answer;
          }
          for (const value of asArray(answer.value.added)) {
            const transaction = readTransaction(value);
            if (transaction !== null) added.push(transaction);
          }
          for (const value of asArray(answer.value.modified)) {
            const transaction = readTransaction(value);
            if (transaction !== null) modified.push(transaction);
          }
          for (const value of asArray(answer.value.removed)) {
            const id = asString(asRecord(value)?.transaction_id);
            if (id !== null) removed.push(id);
          }
          const nextCursor = asString(answer.value.next_cursor);
          if (nextCursor === null) return unreadable();
          next = nextCursor;
          if (answer.value.has_more !== true) break;
        }
        if (restart) continue;
        return { ok: true, value: { added, modified, removed, nextCursor: next ?? "" } };
      }
      return bankFeedFailure("unavailable", "The bank kept changing while it was being read.");
    },

    async disconnect(accessToken) {
      const answer = await call("/item/remove", { access_token: accessToken });
      if (!answer.ok) return answer;
      return { ok: true, value: null };
    },
  };
}
