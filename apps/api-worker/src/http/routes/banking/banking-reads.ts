import { z } from "@hono/zod-openapi";
import {
  BankFeedTransactionsResponse,
  BankingOverviewResponse,
} from "@magna-carta/bank-feeds/contract";
import {
  selectLiveBankFeedAccountsStatement,
  type BankFeedAccountRow,
} from "@magna-carta/bank-feeds/statements";
import { bankFeedCredentialStore } from "../../../banking/bank-credential-store.ts";
import { bankFeedConfigured } from "../../../banking/bank-feed-engine.ts";
import {
  readBankingOverview,
  readLiveConnections,
  readMarkedTransactions,
  transactionWindow,
} from "../../../banking/banking-overview.ts";
import { connectionIsStale, syncBankConnection } from "../../../banking/sync-bank-connection.ts";
import { protectedReadContext } from "../../../protected-read-context.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../../chokepoint/context-accessors.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";
import { runInBackground } from "../../deferred-work.ts";
import {
  problem,
  readMeta,
  resolveBankingDeps,
  type BankingApp,
  type BankingRouteDeps,
} from "./banking-shared.ts";

// THE BANKING SCREEN'S READS. Opening the screen reads any connection whose last read is older than
// SYNC_AFTER_MINUTES (or that the bank asked to be signed in to again) before answering, waiting at
// most SYNC_WAIT_MS: a bank that answers slowly finishes in the background and the screen shows
// what was stored, with its time, rather than hanging.

const SYNC_WAIT_MS = 8_000;

const overviewRoute = defineOpenAPIRoute(readMeta("banking.overview"), {
  method: "get",
  path: "/api/v1/banking",
  description:
    "The firm's connected banks, each bank account they report with the bank's balance beside the " +
    "books' balance, and how many of the bank's recent lines are not in the books. Reads the banks " +
    "again first when the last read is stale. Read only: nothing here posts to the books.",
  responses: {
    200: {
      description: "The Banking screen",
      content: { "application/json": { schema: BankingOverviewResponse } },
    },
    401: problem("No valid session"),
    403: problem("The session member lacks banking:read"),
    404: problem("The firm is unreachable or the member is deactivated"),
    429: problem("Rate limit exceeded"),
  },
});

const transactionsRoute = defineOpenAPIRoute(readMeta("banking.transactions"), {
  method: "get",
  path: "/api/v1/banking/accounts/{accountId}/transactions",
  description:
    "The bank's lines on one account over the last 90 days, newest first, each marked In Books, Not " +
    "in Books or Pending against the account it is tied to in the books. A label only: it clears " +
    "nothing and posts nothing.",
  request: { params: z.object({ accountId: z.string().min(1).max(64) }) },
  responses: {
    200: {
      description: "The account's lines",
      content: { "application/json": { schema: BankFeedTransactionsResponse } },
    },
    401: problem("No valid session"),
    403: problem("The session member lacks banking:read"),
    404: problem("No connected bank account has that id"),
    429: problem("Rate limit exceeded"),
  },
});

export function registerBankingReadRoutes(
  app: BankingApp,
  chokepoint: Chokepoint,
  routeDeps: BankingRouteDeps,
): void {
  const deps = resolveBankingDeps(routeDeps);

  app.openapi(
    { ...overviewRoute, middleware: chokepointMiddleware(chokepoint, overviewRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const now = deps.now();
      const configured = bankFeedConfigured(c.env);
      if (configured) {
        const stale = (await readLiveConnections(firm.firmDatabase)).filter(
          (connection) => connection.sign_in_needed === 1 || connectionIsStale(connection, now),
        );
        if (stale.length > 0) {
          const ports = {
            port: deps.port(c.env),
            credentials: bankFeedCredentialStore(protectedReadContext(c), deps.credentialStoreForFirm),
            database: firm.firmDatabase,
            now: deps.now,
          };
          // A failed read is not this request's failure: the screen shows the last stored figures
          // with their time, and the connection's own state says when the bank wants a sign-in.
          const reads = Promise.allSettled(
            stale.map((connection) => syncBankConnection(ports, connection)),
          );
          const finished = await Promise.race([
            reads.then(() => true),
            new Promise<false>((resolve) => setTimeout(() => resolve(false), SYNC_WAIT_MS)),
          ]);
          if (!finished) runInBackground(c, reads);
        }
      }
      const body = await readBankingOverview(firm.firmDatabase, {
        providerConfigured: configured,
        now: deps.now(),
      });
      return c.json(body, 200);
    },
  );

  app.openapi(
    { ...transactionsRoute, middleware: chokepointMiddleware(chokepoint, transactionsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { accountId } = c.req.valid("param");
      const { results } =
        await selectLiveBankFeedAccountsStatement(firm.firmDatabase).all<BankFeedAccountRow>();
      const account = results.find((row) => row.id === accountId);
      if (account === undefined) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No connected bank account has that id.",
        });
      }
      const now = deps.now();
      const window = transactionWindow(now);
      const transactions = await readMarkedTransactions(firm.firmDatabase, account, now);
      return c.json({ accountId: account.id, ...window, transactions }, 200);
    },
  );
}
