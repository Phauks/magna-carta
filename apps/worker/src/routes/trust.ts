import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import type { MatterId, TrustAccountId, UserId } from "@magna-carta/identifiers/types";
import { currencyFromCode, money } from "@magna-carta/money/money";
import { loadMatterTrustLeaf } from "@magna-carta/trust/account-tree";
import { readTrustAvailableBalance } from "@magna-carta/trust/holds";
import {
  composeMatterToMatterTransfer,
  composeTrustDeposit,
  composeTrustDisbursement,
  type ComposedTrustMovement,
} from "@magna-carta/trust/movements";
import { selectTrustMovementsForNodeStatement } from "@magna-carta/trust/statements";
import { TrustValidationError } from "@magna-carta/trust/trust-validation";
import type { Context } from "hono";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierField, identifierPathParam } from "../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";

// Trust movements: client money into a matter's trust ledger, out of it, and reallocated between two
// matters of one client. Every one of them is idempotency-REQUIRED, because a retried request that
// posted a second entry would be a second real movement of somebody else's money.
//
// This module composes and commits; it decides nothing. The rules live one layer down in
// @magna-carta/trust, whose composition guard is the only supported way to build an entry touching
// client money, and one layer below that in the account_balance floor, which is what actually aborts
// an overdrawing batch. What belongs here is the mapping from a refusal to an HTTP status, and the
// resolution of names the domain will not invent for itself: which member is on the session, and
// what to call a ledger account the firm's chart of accounts has not been built to name yet.

const READ = "trust:read" as const;
const MANAGE = "trust:manage" as const;

// The movement methods a client may state. `internal` is absent deliberately: it is what a
// matter-to-matter reallocation IS, set server-side, never a method a deposit or a disbursement may
// claim — the schema refuses it on either, and leaving it out of the contract means a caller never
// gets that far.
const BankMovementMethod = z.enum(["check", "cash", "wire", "electronic_transfer", "card"]);

const civilDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const DepositRequest = z
  .object({
    trustAccountId: identifierField("trustAccount"),
    matterId: identifierField("matter"),
    // The Directory handle for the client whose money this is. Required rather than derived: a
    // matter's Directory client link does not exist yet, and a trust ledger attributed to the wrong
    // client is the error the whole sub-ledger tree exists to prevent.
    clientEntityId: z.string().min(1),
    amountMinor: z.number().int().positive(),
    currency: z.literal("USD"),
    effectiveDate: civilDate,
    description: z.string().min(1),
    method: BankMovementMethod,
    reference: z.string().min(1).nullable().optional(),
    source: z.string().min(1),
    purpose: z.string().min(1),
  })
  .openapi("TrustDepositRequest");

const DisbursementRequest = z
  .object({
    trustAccountId: identifierField("trustAccount"),
    matterId: identifierField("matter"),
    amountMinor: z.number().int().positive(),
    currency: z.literal("USD"),
    effectiveDate: civilDate,
    description: z.string().min(1),
    method: BankMovementMethod,
    reference: z.string().min(1).nullable().optional(),
    payee: z.string().min(1),
    purpose: z.string().min(1),
  })
  .openapi("TrustDisbursementRequest");

const MatterTransferRequest = z
  .object({
    trustAccountId: identifierField("trustAccount"),
    fromMatterId: identifierField("matter"),
    toMatterId: identifierField("matter"),
    // Carried explicitly rather than copied from the source ledger: a destination matter that
    // belongs to another client must be REFUSED, and inheriting the source's client would instead
    // re-attribute that matter's ledger to this one.
    toClientEntityId: z.string().min(1),
    amountMinor: z.number().int().positive(),
    currency: z.literal("USD"),
    effectiveDate: civilDate,
    description: z.string().min(1),
    purpose: z.string().min(1),
  })
  .openapi("TrustMatterTransferRequest");

const MovementAck = z
  .object({
    trustMovementId: z.string(),
    ledgerEntryId: z.string(),
    trustLedgerNodeId: z.string(),
    counterpartyTrustLedgerNodeId: z.string().nullable(),
  })
  .openapi("TrustMovementAck");

const MovementRecord = z
  .object({
    id: z.string(),
    kind: z.enum(["deposit", "disbursement", "matter_transfer"]),
    trustLedgerNodeId: z.string(),
    counterpartyTrustLedgerNodeId: z.string().nullable(),
    amountMinor: z.number().int(),
    currency: z.string(),
    ledgerEntryId: z.string(),
    method: z.enum(["check", "cash", "wire", "electronic_transfer", "card", "internal"]),
    reference: z.string().nullable(),
    counterpartyName: z.string().nullable(),
    purpose: z.string(),
    recordedBy: z.string(),
    authorizedBy: z.string().nullable(),
    effectiveDate: z.string(),
    recordedAt: z.string(),
  })
  .openapi("TrustMovementRecord");

const ClientLedgerResponse = z
  .object({
    trustLedgerNodeId: z.string(),
    balanceMinor: z.number().int(),
    heldMinor: z.number().int(),
    availableMinor: z.number().int(),
    movements: z.array(MovementRecord),
  })
  .openapi("TrustClientLedgerResponse");

const matterLedgerParam = z.object({ matterId: identifierPathParam("matter", "matterId") });
const matterLedgerQuery = z.object({ trustAccountId: identifierField("trustAccount") });

const errorResponses = {
  400: {
    description: "Missing Idempotency-Key (this operation requires one)",
    content: { "application/problem+json": { schema: Problem } },
  },
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks the required capability",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description:
      "The firm is unreachable, the member is deactivated, or the trust account or matter ledger is unknown",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description:
      "A request with this Idempotency-Key is in progress, or the movement exceeds the client ledger's available balance",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request is invalid, the Idempotency-Key was reused with a different payload, the trust rules refuse the movement, or the account's jurisdiction cannot be resolved",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const readErrorResponses = {
  401: errorResponses[401],
  403: errorResponses[403],
  404: errorResponses[404],
  422: errorResponses[422],
  429: errorResponses[429],
} as const;

function movementMeta(operationId: string): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission: MANAGE,
    // A trust account belongs to an office and its ledger spans many matters, so the capability is
    // firm-scoped even though every movement names a matter.
    resource: "firm",
    audited: true,
    // Money moving is never replayable: a retried deposit that posted twice is a second real
    // movement of a client's funds.
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

const depositRoute = defineOpenAPIRoute(movementMeta("trust.deposit"), {
  method: "post",
  path: "/api/v1/trust/deposits",
  description:
    "Records client money received into a matter's trust ledger. The matter's ledger is created on its first deposit, together with its zero floor and this posting, in one atomic write. The deposit lands gross — a processor or bank fee can never be netted out of it.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: DepositRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The deposit was recorded",
      content: { "application/json": { schema: MovementAck } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const disbursementRoute = defineOpenAPIRoute(movementMeta("trust.disburse"), {
  method: "post",
  path: "/api/v1/trust/disbursements",
  description:
    "Pays client money out of a matter's trust ledger. The amount is measured against the ledger's AVAILABLE balance — the stored balance less any disputed-funds holds — and the authorizing member is recorded on the movement.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: DisbursementRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The disbursement was recorded",
      content: { "application/json": { schema: MovementAck } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const matterTransferRoute = defineOpenAPIRoute(movementMeta("trust.transferBetweenMatters"), {
  method: "post",
  path: "/api/v1/trust/matter-transfers",
  description:
    "Moves trust funds between two matters of the SAME client. No bank movement happens, so no bank line is posted and no reconciliation item is created. A destination matter belonging to a different client is refused.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: MatterTransferRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The transfer was recorded",
      content: { "application/json": { schema: MovementAck } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

const clientLedgerRoute = defineOpenAPIRoute(
  {
    operationId: "trust.matterLedger",
    surface: "app",
    authenticated: true,
    permission: READ,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  },
  {
    method: "get",
    path: "/api/v1/trust/matters/{matterId}/ledger",
    description:
      "Returns one matter's trust ledger: its stored balance, the amount under disputed-funds holds, what is available, and every movement that touched it in effective-date order. A transfer between two matters appears on both.",
    request: { params: matterLedgerParam, query: matterLedgerQuery },
    responses: {
      200: {
        description: "The matter's trust ledger",
        content: { "application/json": { schema: ClientLedgerResponse } },
      },
      401: readErrorResponses[401],
      403: readErrorResponses[403],
      404: readErrorResponses[404],
      422: readErrorResponses[422],
      429: readErrorResponses[429],
    },
  },
);

// A refusal's HTTP status is a property of what the refusal MEANS, so the mapping lives in one
// place rather than at three call sites that would drift.
function trustErrorResponse(
  c: Context,
  error: TrustValidationError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  if (error.code === "unknown-trust-account" || error.code === "unknown-trust-node") {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: error.message,
    });
  }
  if (error.code === "movement-exceeds-available") {
    return problemJson(c, {
      type: "trust-insufficient-available",
      title: "The client ledger does not have that much available",
      status: 409,
      detail: error.message,
    });
  }
  if (error.code === "jurisdiction-not-recorded" || error.code === "jurisdiction-not-encoded") {
    return problemJson(c, {
      type: "trust-jurisdiction-unavailable",
      title: "The trust account's jurisdiction cannot be resolved",
      status: 422,
      detail: error.message,
    });
  }
  // Everything else the trust rules refuse on their own terms: a commingled entry, a second client
  // on one entry, a posting aimed at a roll-up, a closed account, a currency the account does not
  // hold, a transfer to the matter it came from, a forbidden payment method.
  return problemJson(c, {
    type: "trust-movement-refused",
    title: "The trust rules refuse this movement",
    status: 422,
    detail: error.message,
  });
}

type TrustApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

interface MatterNamingRow {
  title: string;
  matter_number: string | null;
  client_display_name: string | null;
}

// Trust does not own the firm's chart of accounts and invents no numbering scheme, so the names for
// a lazily created client node and matter leaf are resolved here, from the matter the firm already
// named. A matter without a number is named by its handle — a ledger account has to be identifiable
// on a report from the day it exists, and a matter draws its number only when it opens.
async function resolveLeafNames(
  database: SqlDatabase,
  matterId: MatterId,
  clientEntityId: string,
): Promise<{ clientNodeName: string; matterLeafName: string }> {
  // `.all()` + `results[0]`, never `.first()` — the node-sqlite adapter the fixtures run on has no
  // `.first()`, so the whole platform reads this way.
  const { results } = await database
    .prepare("SELECT title, matter_number, client_display_name FROM matter WHERE id = ?1")
    .bind(matterId)
    .all<MatterNamingRow>();
  const row = results[0];
  if (!row) {
    // Raised as a trust refusal so it travels the same path to a 404 as every other unknown handle
    // on these routes; the detail names the matter, so the code's vocabulary never reaches a client.
    // Without it the movement would fail later on the node's foreign key, as an opaque batch abort.
    throw new TrustValidationError("unknown-trust-node", `no such matter: ${matterId}`);
  }
  return {
    clientNodeName: `Trust — ${row.client_display_name ?? clientEntityId}`,
    matterLeafName: `Trust — ${row.matter_number ?? matterId} — ${row.title}`,
  };
}

interface MovementRow {
  id: string;
  kind: "deposit" | "disbursement" | "matter_transfer";
  node_id: string;
  counterparty_node_id: string | null;
  amount_minor: number;
  currency: string;
  entry_id: string;
  method: "check" | "cash" | "wire" | "electronic_transfer" | "card" | "internal";
  reference: string | null;
  counterparty_name: string | null;
  purpose: string;
  recorded_by: string;
  authorized_by: string | null;
  effective_date: string;
  recorded_at: string;
}

function rowToMovement(row: MovementRow): z.infer<typeof MovementRecord> {
  return {
    id: row.id,
    kind: row.kind,
    trustLedgerNodeId: row.node_id,
    counterpartyTrustLedgerNodeId: row.counterparty_node_id,
    amountMinor: row.amount_minor,
    currency: row.currency,
    ledgerEntryId: row.entry_id,
    method: row.method,
    reference: row.reference,
    counterpartyName: row.counterparty_name,
    purpose: row.purpose,
    recordedBy: row.recorded_by,
    authorizedBy: row.authorized_by,
    effectiveDate: row.effective_date,
    recordedAt: row.recorded_at,
  };
}

export function registerTrustRoutes(app: TrustApp, chokepoint: Chokepoint): void {
  // The shared idempotent commit for a movement: one batch carrying the ledger entry, its lines,
  // the balance updates, the movement record, the idempotency record, and the outbox message. The
  // account_balance floor aborts all of it together on an overdraw, which is exactly the atomicity
  // the no-negative guarantee depends on.
  async function commitMovement(
    c: Context,
    compose: (recordedBy: UserId) => Promise<ComposedTrustMovement>,
  ) {
    const firm = requireChokepointFirmContext(c);
    const userId = requireChokepointUserId(c);
    const idempotency = requireChokepointIdempotency(c);
    const now = () => new Date().toISOString();
    let result;
    try {
      result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => {
          const movement = await compose(userId);
          return {
            write: movement.effect satisfies EffectWrite,
            responseCode: 201,
            responseBody: canonicalJsonStringify({
              trustMovementId: movement.movementId,
              ledgerEntryId: movement.entryId,
              trustLedgerNodeId: movement.nodeId,
              counterpartyTrustLedgerNodeId: movement.counterpartyNodeId,
            }),
          };
        },
      });
    } catch (caught) {
      if (caught instanceof TrustValidationError) return trustErrorResponse(c, caught);
      throw caught;
    }
    if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
      return problemResponseForIdempotencyConflict(c, result);
    if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
    return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof MovementAck>, 201);
  }

  // POST /api/v1/trust/deposits — client money in
  app.openapi(
    { ...depositRoute, middleware: chokepointMiddleware(chokepoint, depositRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      return commitMovement(c, async (recordedBy) => {
        const names = await resolveLeafNames(
          firm.firmDatabase,
          request.matterId,
          request.clientEntityId,
        );
        return composeTrustDeposit(
          firm.firmDatabase,
          {
            trustAccountId: request.trustAccountId,
            to: {
              clientEntityId: request.clientEntityId,
              matterId: request.matterId,
              ...names,
            },
            amount: money(request.amountMinor, currencyFromCode(request.currency)),
            effectiveDate: request.effectiveDate,
            description: request.description,
            method: request.method,
            reference: request.reference ?? null,
            source: request.source,
            purpose: request.purpose,
            recordedBy,
          },
          { clock: { now: () => new Date().toISOString(), today: todayInUtc } },
        );
      });
    },
  );

  // POST /api/v1/trust/disbursements — client money out
  app.openapi(
    { ...disbursementRoute, middleware: chokepointMiddleware(chokepoint, disbursementRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      return commitMovement(c, async (recordedBy) => {
        const node = await loadMatterTrustLeaf(
          firm.firmDatabase,
          request.trustAccountId,
          request.matterId,
        );
        return composeTrustDisbursement(
          firm.firmDatabase,
          {
            fromNodeId: node.id,
            amount: money(request.amountMinor, currencyFromCode(request.currency)),
            effectiveDate: request.effectiveDate,
            description: request.description,
            method: request.method,
            reference: request.reference ?? null,
            payee: request.payee,
            purpose: request.purpose,
            recordedBy,
            // The member on the session authorized this movement by making it. The record keeps the
            // two roles in separate columns because they diverge as soon as a real authorization
            // workflow exists; naming a DIFFERENT member here from a request body would be an
            // unverified attribution of authority, which is worse than no distinction at all.
            authorizedBy: recordedBy,
          },
          { clock: { now: () => new Date().toISOString(), today: todayInUtc } },
        );
      });
    },
  );

  // POST /api/v1/trust/matter-transfers — a reallocation inside one client's funds
  app.openapi(
    { ...matterTransferRoute, middleware: chokepointMiddleware(chokepoint, matterTransferRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      return commitMovement(c, async (recordedBy) => {
        const from = await loadMatterTrustLeaf(
          firm.firmDatabase,
          request.trustAccountId,
          request.fromMatterId,
        );
        const names = await resolveLeafNames(
          firm.firmDatabase,
          request.toMatterId,
          request.toClientEntityId,
        );
        return composeMatterToMatterTransfer(
          firm.firmDatabase,
          {
            fromNodeId: from.id,
            to: {
              clientEntityId: request.toClientEntityId,
              matterId: request.toMatterId,
              ...names,
            },
            amount: money(request.amountMinor, currencyFromCode(request.currency)),
            effectiveDate: request.effectiveDate,
            description: request.description,
            purpose: request.purpose,
            recordedBy,
            authorizedBy: recordedBy,
          },
          { clock: { now: () => new Date().toISOString(), today: todayInUtc } },
        );
      });
    },
  );

  // GET /api/v1/trust/matters/{matterId}/ledger — the client ledger the record-keeping rules name
  app.openapi(
    { ...clientLedgerRoute, middleware: chokepointMiddleware(chokepoint, clientLedgerRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      const { trustAccountId } = c.req.valid("query");
      // The only refusal a read can raise is "this matter holds no trust ledger", which is a 404 —
      // spelled out here rather than routed through the write-path mapping, whose other statuses
      // this route does not declare and could not honestly return.
      let node;
      try {
        node = await loadMatterTrustLeaf(
          firm.firmDatabase,
          trustAccountId as TrustAccountId,
          matterId,
        );
      } catch (caught) {
        if (caught instanceof TrustValidationError) {
          return problemJson(c, {
            type: "not-found",
            title: "Not found",
            status: 404,
            detail: caught.message,
          });
        }
        throw caught;
      }
      const balance = await readTrustAvailableBalance(firm.firmDatabase, node.id);
      const { results } = await selectTrustMovementsForNodeStatement(
        firm.firmDatabase,
        node.id,
      ).all<MovementRow>();
      return c.json(
        {
          trustLedgerNodeId: node.id,
          balanceMinor: balance.balanceMinor,
          heldMinor: balance.heldMinor,
          availableMinor: balance.availableMinor,
          movements: results.map(rowToMovement),
        },
        200,
      );
    },
  );
}

// The ledger's future-dating check compares against a civil date. The Worker has no user time zone
// on a request, so UTC is the resolution — and it is the same resolution the rest of the platform
// uses for a server-side "today".
const todayInUtc = (): string => new Date().toISOString().slice(0, 10);
