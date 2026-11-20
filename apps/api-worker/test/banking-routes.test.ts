/*
 * The Banking routes through the real chokepoint, with Plaid answered by a stub on globalThis.fetch
 * (the shape translation-routes.test.ts takes for Google). Pins: who may read and who may connect,
 * that the access token is sealed and never answered, that a bank account is tied only to a bank
 * account in the books, that In Books is decided against the books, that a stale connection is read
 * again when the screen opens, and that the bank asking for a sign-in is shown rather than failed.
 */
import { addCalendarDays, todayInUtc } from "@magna-carta/civil-time/civil-date";
import { env } from "cloudflare:test";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { createAccount } from "@magna-carta/ledger/create-account";
import { postEntry } from "@magna-carta/ledger/post-entry";
import { currencyFromCode, money } from "@magna-carta/money/money";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { createApp } from "../src/http/app.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  seedFirmKey,
  signInForSessionCookie,
} from "./support/test-auth.ts";

const app = createApp();
const KEYED = {
  ...env,
  PLAID_CLIENT_ID: "test-client",
  PLAID_SECRET: "test-secret",
  PLAID_ENVIRONMENT: "sandbox",
};
const UNKEYED = { ...env, PLAID_CLIENT_ID: undefined, PLAID_SECRET: undefined };

let ownerCookie: string;
let unprivilegedCookie: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;
let operatingLedgerAccountId: string;
let otherLedgerAccountId: string;

const clock = {
  now: () => new Date().toISOString(),
  today: () => todayInUtc(),
};
const daysAgo = (days: number) => addCalendarDays(todayInUtc(), -days);

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  const { firmId } = await seedFirm({ name: "Banking Firm" });
  await seedFirmKey(firmId);
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
  const { userId } = await seedCredentialedUser("banking-owner@example.com", {
    userName: "Banking Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(userId, "Banking Owner", firmId);
  ownerCookie = await signInForSessionCookie("banking-owner@example.com");
  await seedCredentialedUser("banking-no-role@example.com", { userName: "No Role", firmId });
  unprivilegedCookie = await signInForSessionCookie("banking-no-role@example.com");

  // The firm's operating bank account in the books, and an equity account to post against.
  const bank = await createAccount(
    firmDatabase,
    { name: "Operating", type: "asset", currency: "USD" },
    { clock },
  );
  const equity = await createAccount(
    firmDatabase,
    { name: "Owner Equity", type: "equity", currency: "USD" },
    { clock },
  );
  await commitEffectBatch(firmDatabase, bank.effect, { now: clock.now });
  await commitEffectBatch(firmDatabase, equity.effect, { now: clock.now });
  operatingLedgerAccountId = bank.accountId;
  otherLedgerAccountId = equity.accountId;
  await firmDatabase
    .prepare(
      "INSERT INTO firm_account_role (role, ledger_account_id, created_at, updated_at) VALUES ('operating_bank', ?1, ?2, ?2)",
    )
    .bind(bank.accountId, clock.now())
    .run();
  // The books hold one deposit of $500.00 three days ago.
  const posted = await postEntry(
    firmDatabase,
    {
      description: "Retainer deposit",
      effectiveDate: daysAgo(3),
      lines: [
        {
          accountId: bank.accountId,
          direction: "debit",
          amount: money(50_000, currencyFromCode("USD")),
        },
        {
          accountId: equity.accountId,
          direction: "credit",
          amount: money(50_000, currencyFromCode("USD")),
        },
      ],
    },
    { clock },
  );
  await commitEffectBatch(firmDatabase, posted.effect, { now: clock.now });
});

let requests = 0;
function request(
  method: string,
  path: string,
  cookie: string | undefined,
  body?: unknown,
): [string, RequestInit] {
  requests += 1;
  return [
    `https://example.com/api/v1/${path}`,
    {
      method,
      headers: {
        ...(cookie === undefined ? {} : { cookie }),
        origin: "https://example.com",
        "content-type": "application/json",
        "Idempotency-Key": `banking-${String(requests)}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  ];
}

/** Answer Plaid's sandbox host by path and let every other request through. */
const originalFetch = globalThis.fetch;
const plaidCalls: { path: string; body: Record<string, unknown> }[] = [];
let plaidAnswers: Record<string, () => Response> = {};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function answerPlaid(): void {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "sandbox.plaid.com") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      plaidCalls.push({ path: url.pathname, body });
      const answer = plaidAnswers[url.pathname];
      return Promise.resolve(
        answer === undefined ? json({ error_code: "UNEXPECTED" }, 400) : answer(),
      );
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}
afterEach(() => {
  globalThis.fetch = originalFetch;
  plaidCalls.length = 0;
});

const PLAID_ACCOUNTS = {
  accounts: [
    {
      account_id: "acct-checking",
      name: "Business Checking",
      official_name: null,
      mask: "4417",
      type: "depository",
      subtype: "checking",
      balances: { current: 61880.12, available: 61500, iso_currency_code: "USD" },
    },
  ],
};

function healthyPlaid(): void {
  plaidAnswers = {
    "/link/token/create": () =>
      json({ link_token: "link-sandbox-1", expiration: "2099-01-01T00:00:00Z" }),
    "/item/public_token/exchange": () =>
      json({ access_token: "access-sandbox-secret", item_id: "item-1" }),
    "/item/get": () =>
      json({ item: { institution_name: "Cumberland Bank", institution_id: "ins_cumberland" } }),
    "/institutions/get_by_id": () =>
      json({ institution: { name: "Cumberland Bank", logo: "iVBORw0KGgo=" } }),
    "/accounts/balance/get": () => json(PLAID_ACCOUNTS),
    "/transactions/sync": () =>
      json({
        added: [
          // $500.00 in, two days after the books' deposit: In Books.
          {
            transaction_id: "t-in",
            account_id: "acct-checking",
            date: daysAgo(1),
            amount: -500,
            name: "DEPOSIT",
            pending: false,
          },
          // $412.00 out that the books do not hold: Not in Books.
          {
            transaction_id: "t-out",
            account_id: "acct-checking",
            date: daysAgo(2),
            amount: 412,
            original_description: "WESTLAW ACH",
            pending: false,
          },
          // Pending: neither.
          {
            transaction_id: "t-pending",
            account_id: "acct-checking",
            date: daysAgo(0),
            amount: 25,
            name: "FEE",
            pending: true,
          },
        ],
        modified: [],
        removed: [],
        next_cursor: "cursor-1",
        has_more: false,
      }),
  };
}

describe("who may use Banking", () => {
  it("refuses a caller with no session", async () => {
    const response = await app.request(...request("GET", "banking", undefined), KEYED);
    expect(response.status).toBe(401);
  });

  it("refuses a member without banking:read or banking:manage", async () => {
    expect(
      (await app.request(...request("GET", "banking", unprivilegedCookie), KEYED)).status,
    ).toBe(403);
    const connect = await app.request(
      ...request("POST", "banking/connections", unprivilegedCookie, { publicToken: "public-1" }),
      KEYED,
    );
    expect(connect.status).toBe(403);
  });
});

describe("a deployment with no Plaid keys", () => {
  it("says bank feeds are not set up and refuses to start a sign-in", async () => {
    const overview = await app.request(...request("GET", "banking", ownerCookie), UNKEYED);
    expect(overview.status).toBe(200);
    expect(await overview.json()).toMatchObject({
      providerConfigured: false,
      connections: [],
      accounts: [],
    });
    const token = await app.request(
      ...request("POST", "banking/sign-in-token", ownerCookie, {}),
      UNKEYED,
    );
    expect(token.status).toBe(503);
  });
});

describe("connecting a bank and tying its account to the books", () => {
  let connectionId: string;
  let accountId: string;

  it("hands the browser a sign-in token and keeps the keys in the body", async () => {
    healthyPlaid();
    answerPlaid();
    const response = await app.request(
      ...request("POST", "banking/sign-in-token", ownerCookie, {}),
      KEYED,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      token: "link-sandbox-1",
      expiresAt: "2099-01-01T00:00:00Z",
    });
    expect(plaidCalls[0]?.body).toMatchObject({
      client_id: "test-client",
      secret: "test-secret",
      products: ["transactions"],
    });
  });

  it("connects, seals the access token, and reads the bank's accounts and lines", async () => {
    healthyPlaid();
    answerPlaid();
    const response = await app.request(
      ...request("POST", "banking/connections", ownerCookie, { publicToken: "public-1" }),
      KEYED,
    );
    expect(response.status).toBe(201);
    const text = await response.text();
    expect(text).not.toContain("access-sandbox-secret");
    connectionId = (JSON.parse(text) as { connectionId: string }).connectionId;
    expect(plaidCalls.map((call) => call.path)).toEqual([
      "/item/public_token/exchange",
      "/item/get",
      "/institutions/get_by_id",
      "/accounts/balance/get",
      "/transactions/sync",
    ]);
    // The token is in the credential store, sealed: nowhere in the connection's row.
    const { results } = await firmDatabase
      .prepare("SELECT * FROM bank_connection WHERE id = ?1")
      .bind(connectionId)
      .all();
    expect(JSON.stringify(results)).not.toContain("access-sandbox-secret");
    expect(results[0]).toMatchObject({
      institution_name: "Cumberland Bank",
      institution_logo: "iVBORw0KGgo=",
      sync_cursor: "cursor-1",
    });
  });

  it("lists the account untied, with the bank's balance and the books' accounts to choose from", async () => {
    healthyPlaid();
    answerPlaid();
    const response = await app.request(...request("GET", "banking", ownerCookie), KEYED);
    const body = (await response.json()) as {
      providerConfigured: boolean;
      accounts: { id: string; bankBalanceMinor: number; bookAccount: unknown; mask: string }[];
      bookAccounts: { ledgerAccountId: string; kind: string }[];
      connections: { institutionName: string; signInNeeded: boolean }[];
    };
    expect(body.providerConfigured).toBe(true);
    expect(body.connections).toEqual([
      expect.objectContaining({
        institutionName: "Cumberland Bank",
        institutionLogo: "iVBORw0KGgo=",
        signInNeeded: false,
      }),
    ]);
    expect(body.accounts).toEqual([
      expect.objectContaining({ mask: "4417", bankBalanceMinor: 6_188_012, bookAccount: null }),
    ]);
    expect(body.bookAccounts).toEqual([
      expect.objectContaining({ ledgerAccountId: operatingLedgerAccountId, kind: "operating" }),
    ]);
    accountId = body.accounts[0]!.id;
    // Read moments ago: the screen does not ask the bank again.
    expect(plaidCalls).toEqual([]);
  });

  it("refuses to tie an account to something that is not a bank account in the books", async () => {
    const response = await app.request(
      ...request("PUT", `banking/accounts/${accountId}/book-account`, ownerCookie, {
        ledgerAccountId: otherLedgerAccountId,
      }),
      KEYED,
    );
    expect(response.status).toBe(422);
  });

  it("ties it to the operating account and marks the bank's lines against the books", async () => {
    const tie = await app.request(
      ...request("PUT", `banking/accounts/${accountId}/book-account`, ownerCookie, {
        ledgerAccountId: operatingLedgerAccountId,
      }),
      KEYED,
    );
    expect(tie.status).toBe(204);
    const overview = (await (
      await app.request(...request("GET", "banking", ownerCookie), KEYED)
    ).json()) as {
      accounts: {
        booksBalanceMinor: number;
        notInBooksCount: number;
        bookAccount: { kind: string };
      }[];
    };
    expect(overview.accounts[0]).toMatchObject({
      booksBalanceMinor: 50_000,
      notInBooksCount: 1,
      bookAccount: expect.objectContaining({ kind: "operating" }),
    });
    const lines = await app.request(
      ...request("GET", `banking/accounts/${accountId}/transactions`, ownerCookie),
      KEYED,
    );
    const { transactions } = (await lines.json()) as {
      transactions: { description: string; amountMinor: number; status: string }[];
    };
    expect(transactions.map((line) => [line.description, line.amountMinor, line.status])).toEqual([
      ["FEE", -2_500, "pending"],
      ["DEPOSIT", 50_000, "inBooks"],
      ["WESTLAW ACH", -41_200, "notInBooks"],
    ]);
  });

  it("shows a bank that wants a new sign-in, and asks again when the screen opens", async () => {
    await firmDatabase
      .prepare(
        "UPDATE bank_connection SET last_synced_at = '2000-01-01T00:00:00.000Z' WHERE id = ?1",
      )
      .bind(connectionId)
      .run();
    plaidAnswers = {
      "/accounts/balance/get": () =>
        json({ error_type: "ITEM_ERROR", error_code: "ITEM_LOGIN_REQUIRED" }, 400),
    };
    answerPlaid();
    const response = await app.request(...request("GET", "banking", ownerCookie), KEYED);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { connections: { signInNeeded: boolean }[] };
    expect(body.connections[0]?.signInNeeded).toBe(true);
    // The last balance stays on the screen.
    expect(plaidCalls.map((call) => call.path)).toEqual(["/accounts/balance/get"]);
  });

  it("disconnects: ends the sign-in at Plaid, unties the account, keeps what the bank said", async () => {
    plaidAnswers = { "/item/remove": () => json({ request_id: "r" }) };
    answerPlaid();
    const response = await app.request(
      ...request("DELETE", `banking/connections/${connectionId}`, ownerCookie),
      KEYED,
    );
    expect(response.status).toBe(204);
    expect(plaidCalls.map((call) => call.path)).toEqual(["/item/remove"]);
    const overview = (await (
      await app.request(...request("GET", "banking", ownerCookie), KEYED)
    ).json()) as {
      connections: unknown[];
      accounts: unknown[];
      bookAccounts: { feedAccountId: string | null }[];
    };
    expect(overview.connections).toEqual([]);
    expect(overview.accounts).toEqual([]);
    expect(overview.bookAccounts[0]?.feedAccountId).toBeNull();
    const { results } = await firmDatabase
      .prepare("SELECT COUNT(*) AS lines FROM bank_feed_transaction")
      .all<{ lines: number }>();
    expect(results[0]?.lines).toBe(3);
  });
});
