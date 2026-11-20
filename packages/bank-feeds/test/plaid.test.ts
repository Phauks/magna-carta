import { describe, expect, it } from "vitest";
import { plaidBankFeedPort } from "../src/plaid.ts";

interface Seen {
  url: string;
  body: Record<string, unknown>;
}

function fakeFetch(answers: readonly { status?: number; body: unknown }[]) {
  const seen: Seen[] = [];
  let index = 0;
  const fetcher = (url: string, init: RequestInit): Promise<Response> => {
    seen.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    const answer = answers[Math.min(index, answers.length - 1)]!;
    index += 1;
    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return { seen, fetcher };
}

const credentials = { clientId: "client", secret: "secret", environment: "sandbox" as const };

describe("plaidBankFeedPort", () => {
  it("asks for transactions only, limited to checking and savings, with the keys in the body", async () => {
    const { seen, fetcher } = fakeFetch([
      { body: { link_token: "link-sandbox-1", expiration: "2026-11-20T23:00:00Z" } },
    ]);
    const port = plaidBankFeedPort(credentials, fetcher);
    const answer = await port.signInToken({ clientUserId: "firm_1" });
    expect(answer).toEqual({
      ok: true,
      value: { token: "link-sandbox-1", expiresAt: "2026-11-20T23:00:00Z" },
    });
    expect(seen[0]!.url).toBe("https://sandbox.plaid.com/link/token/create");
    expect(seen[0]!.body).toMatchObject({
      client_id: "client",
      secret: "secret",
      products: ["transactions"],
      account_filters: { depository: { account_subtypes: ["checking", "savings"] } },
      user: { client_user_id: "firm_1" },
    });
  });

  it("signs in again in update mode with the access token and no products", async () => {
    const { seen, fetcher } = fakeFetch([{ body: { link_token: "t", expiration: "x" } }]);
    await plaidBankFeedPort(credentials, fetcher).signInToken({
      clientUserId: "firm_1",
      accessToken: "access-1",
    });
    expect(seen[0]!.body.access_token).toBe("access-1");
    expect(seen[0]!.body.products).toBeUndefined();
  });

  it("reads the bank's name and logo, and keeps the name when the logo cannot be read", async () => {
    const { seen, fetcher } = fakeFetch([
      { body: { item: { institution_name: "Cumberland Bank", institution_id: "ins_1" } } },
      { body: { institution: { name: "Cumberland Bank", logo: "iVBORw0KGgo=" } } },
    ]);
    expect(await plaidBankFeedPort(credentials, fetcher).institution("access-1")).toEqual({
      ok: true,
      value: { name: "Cumberland Bank", logo: "iVBORw0KGgo=" },
    });
    expect(seen[1]!.url).toBe("https://sandbox.plaid.com/institutions/get_by_id");
    expect(seen[1]!.body).toMatchObject({
      institution_id: "ins_1",
      options: { include_optional_metadata: true },
    });
    const failing = fakeFetch([
      { body: { item: { institution_name: "Cumberland Bank", institution_id: "ins_1" } } },
      { status: 400, body: { error_type: "INVALID_INPUT", error_code: "INVALID_INSTITUTION" } },
    ]);
    expect(await plaidBankFeedPort(credentials, failing.fetcher).institution("access-1")).toEqual({
      ok: true,
      value: { name: "Cumberland Bank", logo: null },
    });
  });

  it("turns Plaid's amounts round so money in is positive, and keeps the bank's own words", async () => {
    const { fetcher } = fakeFetch([
      {
        body: {
          added: [
            {
              transaction_id: "t1",
              account_id: "a1",
              date: "2026-11-19",
              amount: 412.0,
              name: "Westlaw",
              original_description: "WESTLAW THOMSON REUTERS ACH",
              pending: false,
              check_number: null,
            },
            {
              transaction_id: "t2",
              account_id: "a1",
              date: "2026-11-17",
              amount: -3180.07,
              name: "Deposit",
              pending: true,
              check_number: "1042",
            },
          ],
          modified: [],
          removed: [{ transaction_id: "t0" }],
          next_cursor: "c2",
          has_more: false,
        },
      },
    ]);
    const answer = await plaidBankFeedPort(credentials, fetcher).transactions("access", "c1");
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.value.nextCursor).toBe("c2");
    expect(answer.value.removed).toEqual(["t0"]);
    expect(answer.value.added).toEqual([
      expect.objectContaining({
        remoteTransactionId: "t1",
        amountMinor: -41_200,
        description: "WESTLAW THOMSON REUTERS ACH",
        pending: false,
      }),
      expect.objectContaining({
        remoteTransactionId: "t2",
        amountMinor: 318_007,
        checkNumber: "1042",
        pending: true,
      }),
    ]);
  });

  it("follows has_more across pages and restarts when the bank changes mid-read", async () => {
    const { seen, fetcher } = fakeFetch([
      { body: { added: [], modified: [], removed: [], next_cursor: "p1", has_more: true } },
      {
        status: 400,
        body: {
          error_type: "TRANSACTIONS_ERROR",
          error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
        },
      },
      { body: { added: [], modified: [], removed: [], next_cursor: "p1", has_more: true } },
      { body: { added: [], modified: [], removed: [], next_cursor: "p2", has_more: false } },
    ]);
    const answer = await plaidBankFeedPort(credentials, fetcher).transactions("access", null);
    expect(answer).toEqual({
      ok: true,
      value: { added: [], modified: [], removed: [], nextCursor: "p2" },
    });
    expect(seen.map((call) => call.body.cursor)).toEqual([undefined, "p1", undefined, "p1"]);
  });

  it("reads a bank's request to sign in again as sign-in-needed, and never echoes the token", async () => {
    const { fetcher } = fakeFetch([
      { status: 400, body: { error_type: "ITEM_ERROR", error_code: "ITEM_LOGIN_REQUIRED" } },
    ]);
    const answer = await plaidBankFeedPort(credentials, fetcher).accounts("access-secret-token");
    expect(answer).toEqual({
      ok: false,
      reason: "sign-in-needed",
      detail: "The bank feed answered ITEM_LOGIN_REQUIRED.",
    });
  });

  it("reads balances in minor units from the live balance call", async () => {
    const { seen, fetcher } = fakeFetch([
      {
        body: {
          accounts: [
            {
              account_id: "a1",
              name: "Business Checking",
              official_name: null,
              mask: "4417",
              type: "depository",
              subtype: "checking",
              balances: { current: 61880.12, available: 61500, iso_currency_code: "USD" },
            },
          ],
        },
      },
    ]);
    const answer = await plaidBankFeedPort(credentials, fetcher).accounts("access");
    expect(seen[0]!.url).toBe("https://sandbox.plaid.com/accounts/balance/get");
    expect(answer).toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          remoteAccountId: "a1",
          mask: "4417",
          currentBalanceMinor: 6_188_012,
          availableBalanceMinor: 6_150_000,
        }),
      ],
    });
  });

  it("answers unavailable when Plaid cannot be reached", async () => {
    const port = plaidBankFeedPort(credentials, () => Promise.reject(new Error("offline")));
    expect(await port.exchange("public")).toMatchObject({ ok: false, reason: "unavailable" });
  });
});
