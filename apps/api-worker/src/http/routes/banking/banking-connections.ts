import { z } from "@hono/zod-openapi";
import {
  BankSignInTokenRequest,
  BankSignInTokenResponse,
  ConnectBankRequest,
  ConnectBankResponse,
  LinkBankFeedAccountRequest,
} from "@magna-carta/bank-feeds/contract";
import type { BankFeedFailure } from "@magna-carta/bank-feeds/port";
import {
  disconnectBankConnectionStatements,
  insertBankConnectionStatement,
  linkBankFeedAccountStatement,
  reopenBankConnectionStatement,
  selectBankConnectionByRemoteItemStatement,
  selectLiveBankConnectionStatement,
  selectLiveBankFeedAccountsStatement,
  type BankConnectionRow,
  type BankFeedAccountRow,
} from "@magna-carta/bank-feeds/statements";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { BankConnectionId } from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import {
  bankFeedCredentialRef,
  bankFeedCredentialStore,
  readBankAccessToken,
} from "../../../banking/bank-credential-store.ts";
import { readBookAccounts } from "../../../banking/banking-overview.ts";
import { syncBankConnection } from "../../../banking/sync-bank-connection.ts";
import { protectedReadContext } from "../../../protected-read-context.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader } from "../../contracts/common.ts";
import { problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
import {
  manageMeta,
  problem,
  resolveBankingDeps,
  type BankingApp,
  type BankingRouteDeps,
} from "./banking-shared.ts";

// CONNECTING, TYING AND DISCONNECTING A BANK. Behind banking:manage. The browser never holds the
// access token: it gets a short-lived sign-in token to open the provider's window, hands back the
// one-time public token that window produced, and the Worker exchanges it and seals the result.

const signInTokenRoute = defineOpenAPIRoute(manageMeta("banking.signInToken", "optional"), {
  method: "post",
  path: "/api/v1/banking/sign-in-token",
  description:
    "A short-lived token that opens the bank feed provider's sign-in window, for a new bank or, " +
    "with connectionId, to sign in again to one the bank asked about.",
  request: {
    body: { content: { "application/json": { schema: BankSignInTokenRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The sign-in token",
      content: { "application/json": { schema: BankSignInTokenResponse } },
    },
    401: problem("No valid session"),
    403: problem("The session member lacks banking:manage"),
    404: problem("No connected bank has that id"),
    422: problem("The request body is invalid"),
    429: problem("Rate limit exceeded"),
    503: problem("No bank feed is set up, or the provider did not answer"),
  },
});

const connectRoute = defineOpenAPIRoute(manageMeta("banking.connect", "required"), {
  method: "post",
  path: "/api/v1/banking/connections",
  description:
    "Records a bank the firm just signed in to: exchanges the provider's one-time token, seals the " +
    "access token, and reads the bank's accounts. Each account starts untied from the books.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: ConnectBankRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The connection",
      content: { "application/json": { schema: ConnectBankResponse } },
    },
    400: problem("The Idempotency-Key header is missing"),
    401: problem("No valid session"),
    403: problem("The session member lacks banking:manage"),
    404: problem("The firm is unreachable or the member is deactivated"),
    409: problem("A request with this Idempotency-Key is already in progress"),
    422: problem("The provider refused the token, or the body is invalid"),
    429: problem("Rate limit exceeded"),
    503: problem("No bank feed is set up, or the provider did not answer"),
  },
});

const accountParams = z.object({ accountId: z.string().min(1).max(64) });
const connectionParams = z.object({ connectionId: z.string().min(1).max(64) });

const linkRoute = defineOpenAPIRoute(manageMeta("banking.linkAccount", "required"), {
  method: "put",
  path: "/api/v1/banking/accounts/{accountId}/book-account",
  description:
    "Ties a bank account the feed reports to a bank account in the books (an operating account or a " +
    "trust account's bank), or unties it with null. One feed per account in the books.",
  request: {
    headers: idempotencyKeyHeader,
    params: accountParams,
    body: {
      content: { "application/json": { schema: LinkBankFeedAccountRequest } },
      required: true,
    },
  },
  responses: {
    204: { description: "Tied, or untied" },
    400: problem("The Idempotency-Key header is missing"),
    401: problem("No valid session"),
    403: problem("The session member lacks banking:manage"),
    404: problem("No connected bank account has that id"),
    409: problem("Another bank account is already tied to that account in the books"),
    422: problem("That is not a bank account in the books, or the body is invalid"),
    429: problem("Rate limit exceeded"),
  },
});

const disconnectRoute = defineOpenAPIRoute(
  // Putting it back is signing in to the bank again through Connect Bank.
  {
    ...manageMeta("banking.disconnect", "required"),
    reversal: { kind: "inverse", by: "banking.connect" },
  },
  {
    method: "delete",
    path: "/api/v1/banking/connections/{connectionId}",
    description:
      "Stops reading a bank: ends the sign-in at the provider and unties its accounts. What the bank " +
      "already reported stays on the record.",
    request: { headers: idempotencyKeyHeader, params: connectionParams },
    responses: {
      204: { description: "Disconnected" },
      400: problem("The Idempotency-Key header is missing"),
      401: problem("No valid session"),
      403: problem("The session member lacks banking:manage"),
      404: problem("No connected bank has that id"),
      409: problem("A request with this Idempotency-Key is already in progress"),
      422: problem("The Idempotency-Key was reused with a different request"),
      429: problem("Rate limit exceeded"),
    },
  },
);

const unavailable = (c: Context, failure: BankFeedFailure) =>
  problemJson(c, {
    type: "service-unavailable",
    title:
      failure.reason === "not-configured"
        ? "Bank feeds are not set up"
        : "The bank feed did not answer",
    status: 503,
    detail:
      failure.reason === "not-configured"
        ? "This site has no bank feed keys yet."
        : "The bank feed did not answer. Try again in a few minutes.",
  });

const notFound = (c: Context, detail: string) =>
  problemJson(c, { type: "not-found", title: "Not found", status: 404, detail });

// A failure inside an idempotent effect: thrown so nothing is stored, turned into a problem outside.
class BankRefusal extends Error {
  constructor(readonly failure: BankFeedFailure) {
    super("bank refusal");
  }
}

async function liveConnection(
  c: Context,
  connectionId: string,
): Promise<BankConnectionRow | undefined> {
  const firm = requireChokepointFirmContext(c);
  const { results } = await selectLiveBankConnectionStatement(
    firm.firmDatabase,
    connectionId,
  ).all<BankConnectionRow>();
  return results[0];
}

export function registerBankingConnectionRoutes(
  app: BankingApp,
  chokepoint: Chokepoint,
  routeDeps: BankingRouteDeps,
): void {
  const deps = resolveBankingDeps(routeDeps);
  const credentials = (c: Context) =>
    bankFeedCredentialStore(protectedReadContext(c), deps.credentialStoreForFirm);

  async function commit(
    c: Context,
    responseCode: 201 | 204,
    build: () => Promise<{ write: EffectWrite; body: unknown }>,
  ): Promise<
    | { readonly conflict: { readonly kind: "in-progress" | "fingerprint-mismatch" } }
    | { readonly body: unknown }
  > {
    const firm = requireChokepointFirmContext(c);
    const idempotency = requireChokepointIdempotency(c);
    let body: unknown = null;
    const result = await runIdempotentEffect({
      database: firm.firmDatabase,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      effect: async () => {
        const built = await build();
        body = built.body;
        return {
          write: built.write,
          responseCode,
          responseBody: body === null ? null : canonicalJsonStringify(body),
        };
      },
    });
    if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
      return { conflict: result };
    }
    if (result.kind === "replayed") {
      c.header("Idempotency-Replayed", "true");
      body = result.responseBody === null ? null : (JSON.parse(result.responseBody) as unknown);
    }
    return { body };
  }

  app.openapi(
    { ...signInTokenRoute, middleware: chokepointMiddleware(chokepoint, signInTokenRoute) },
    async (c) => {
      const port = deps.port(c.env);
      const { connectionId } = c.req.valid("json");
      let accessToken: string | undefined;
      if (connectionId !== undefined) {
        const connection = await liveConnection(c, connectionId);
        if (connection === undefined) return notFound(c, "No connected bank has that id.");
        accessToken =
          (await readBankAccessToken(credentials(c), connection.credential_ref)) ?? undefined;
        if (accessToken === undefined)
          return notFound(c, "That bank's sign-in is missing. Connect it again.");
      }
      const answer = await port.signInToken({
        clientUserId: requireChokepointFirmId(c),
        ...(accessToken === undefined ? {} : { accessToken }),
      });
      if (!answer.ok) return unavailable(c, answer);
      return c.json(answer.value, 200);
    },
  );

  app.openapi(
    { ...connectRoute, middleware: chokepointMiddleware(chokepoint, connectRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const port = deps.port(c.env);
      const { publicToken } = c.req.valid("json");
      const store = credentials(c);
      let outcome;
      try {
        outcome = await commit(c, 201, async () => {
          const exchanged = await port.exchange(publicToken);
          if (!exchanged.ok) throw new BankRefusal(exchanged);
          const institution = await port.institution(exchanged.value.accessToken);
          const institutionName = institution.ok ? institution.value.name : "Bank";
          const institutionLogo = institution.ok ? institution.value.logo : null;
          const { results } = await selectBankConnectionByRemoteItemStatement(
            firm.firmDatabase,
            port.provider,
            exchanged.value.remoteItemId,
          ).all<BankConnectionRow>();
          const existing = results[0];
          const connectionId = existing?.id ?? newIdentifier("bankConnection");
          const credentialRef = existing?.credential_ref ?? bankFeedCredentialRef(connectionId);
          // The token first, then the row that points at it: a row over a token never stored would
          // say the bank is connected when nothing can read it.
          // fitness:allow-no-dimensions — not a bucket write: this seals a credential into the
          // per-firm integration_credential table, and nothing reaches object storage.
          await store.put(credentialRef, { kind: "apiKey", apiKey: exchanged.value.accessToken });
          const now = deps.now().toISOString();
          return {
            write: {
              statements: [
                existing === undefined
                  ? insertBankConnectionStatement(firm.firmDatabase, {
                      id: connectionId,
                      provider: port.provider,
                      remoteItemId: exchanged.value.remoteItemId,
                      institutionName,
                      institutionLogo,
                      credentialRef,
                      connectedBy: userId,
                      connectedAt: now,
                    })
                  : reopenBankConnectionStatement(
                      firm.firmDatabase,
                      connectionId,
                      institutionName,
                      institutionLogo,
                    ),
                insertAuditLogStatement(firm.firmDatabase, {
                  id: newIdentifier("auditLog"),
                  event: "banking.bank_connected",
                  actorUserId: userId,
                  subjectId: connectionId,
                  // Which provider, never which bank or which accounts.
                  metadata: { provider: port.provider },
                  now,
                }),
              ],
              outboxMessages: [],
            },
            body: { connectionId },
          };
        });
      } catch (caught) {
        if (!(caught instanceof BankRefusal)) throw caught;
        if (caught.failure.reason === "refused") {
          return problemJson(c, {
            type: "validation",
            title: "The bank sign-in did not finish",
            status: 422,
            detail: "The bank feed refused the sign-in. Try Connect Bank again.",
          });
        }
        return unavailable(c, caught.failure);
      }
      if ("conflict" in outcome) return problemResponseForIdempotencyConflict(c, outcome.conflict);
      const body = outcome.body as { connectionId: BankConnectionId };
      // Read the bank's accounts now, so the window that asks which account is which has them. A
      // failure here is not the connection's: the next opening of the screen reads again.
      const connection = await liveConnection(c, body.connectionId);
      if (connection !== undefined) {
        await syncBankConnection(
          { port, credentials: store, database: firm.firmDatabase, now: deps.now },
          connection,
        ).catch(() => "failed");
      }
      return c.json(body, 201);
    },
  );

  app.openapi(
    { ...linkRoute, middleware: chokepointMiddleware(chokepoint, linkRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { accountId } = c.req.valid("param");
      const { ledgerAccountId } = c.req.valid("json");
      const { results } = await selectLiveBankFeedAccountsStatement(
        firm.firmDatabase,
      ).all<BankFeedAccountRow>();
      if (!results.some((row) => row.id === accountId)) {
        return notFound(c, "No connected bank account has that id.");
      }
      if (ledgerAccountId !== null) {
        const book = (await readBookAccounts(firm.firmDatabase)).find(
          (account) => account.ledgerAccountId === ledgerAccountId,
        );
        if (book === undefined) {
          return problemJson(c, {
            type: "validation",
            title: "Not a bank account in the books",
            status: 422,
            detail: "Choose an operating account or a trust account.",
          });
        }
        if (book.feedAccountId !== null && book.feedAccountId !== accountId) {
          return problemJson(c, {
            type: "conflict",
            title: "Already tied",
            status: 409,
            detail: `Another bank account is already tied to ${book.name}. Untie it first.`,
          });
        }
      }
      const outcome = await commit(c, 204, () => {
        const now = deps.now().toISOString();
        return Promise.resolve({
          write: {
            statements: [
              linkBankFeedAccountStatement(firm.firmDatabase, {
                accountId,
                ledgerAccountId,
                linkedBy: userId,
                now,
              }),
              insertAuditLogStatement(firm.firmDatabase, {
                id: newIdentifier("auditLog"),
                event: "banking.account_tied",
                actorUserId: userId,
                subjectId: accountId,
                metadata: { ledgerAccountId },
                now,
              }),
            ],
            outboxMessages: [],
          },
          body: null,
        });
      });
      if ("conflict" in outcome) return problemResponseForIdempotencyConflict(c, outcome.conflict);
      return c.body(null, 204);
    },
  );

  app.openapi(
    { ...disconnectRoute, middleware: chokepointMiddleware(chokepoint, disconnectRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { connectionId } = c.req.valid("param");
      const connection = await liveConnection(c, connectionId);
      if (connection === undefined) return notFound(c, "No connected bank has that id.");
      // End the sign-in at the provider first, so the bank stops sharing and the provider stops
      // billing. A provider that does not answer does not keep the firm connected: the row is
      // closed either way, and the token stays sealed for an administrator to revoke at Plaid.
      const accessToken = await readBankAccessToken(credentials(c), connection.credential_ref);
      if (accessToken !== null) await deps.port(c.env).disconnect(accessToken);
      const outcome = await commit(c, 204, () => {
        const now = deps.now().toISOString();
        return Promise.resolve({
          write: {
            statements: [
              ...disconnectBankConnectionStatements(firm.firmDatabase, {
                connectionId: connection.id,
                by: userId,
                now,
              }),
              insertAuditLogStatement(firm.firmDatabase, {
                id: newIdentifier("auditLog"),
                event: "banking.bank_disconnected",
                actorUserId: userId,
                subjectId: connection.id,
                metadata: { provider: connection.provider },
                now,
              }),
            ],
            outboxMessages: [],
          },
          body: null,
        });
      });
      if ("conflict" in outcome) return problemResponseForIdempotencyConflict(c, outcome.conflict);
      return c.body(null, 204);
    },
  );
}
