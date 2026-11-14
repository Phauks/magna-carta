import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { identifierField } from "@magna-carta/identifiers/field";
import type { TrustAccountId, TrustCheckId, TrustMovementId } from "@magna-carta/identifiers/types";
import { loadTrustAccount } from "@magna-carta/trust/account-tree";
import {
  Acknowledgement,
  ChecksResponse,
  CheckToPrint,
  PrintRequest,
  PrintResponse,
  RegisterRow,
  ResultsRequest,
  VoidRequest,
} from "@magna-carta/trust/check-contract";
import {
  composeTrustCheckNumberVoid,
  composeTrustCheckPrint,
  composeTrustCheckResults,
  composeTrustCheckVoid,
  readCurrentTrustCheckStock,
  readNextTrustCheckNumber,
  readTrustCheckRegister,
  readTrustChecksToPrint,
  type TrustCheckRegisterRow,
  type TrustCheckToPrint,
} from "@magna-carta/trust/checks";
import { TrustValidationError } from "@magna-carta/trust/trust-validation";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";
import {
  commitTrustCheckWrite,
  trustCheckErrors,
  trustCheckOptions,
  trustCheckReadMeta,
  trustCheckStockRecord,
  trustCheckWriteMeta,
} from "./trust-check-support.ts";

// CHECK PRINTING: the queue of payments waiting for a check, the register of every number used,
// the stock that says where each field prints, and the scan of a blank check that stock is placed
// over. The rules are @magna-carta/trust's (src/checks.ts) and the migration's triggers; this module
// composes, commits and answers.
//
// The server never makes the PDF. A print request numbers the checks and returns what each one
// says; the browser composes the PDF from that in a Web Worker. So a print is a small write, and the
// CPU work of laying out pages stays off the request path.

const trustAccountQuery = z.object({ trustAccountId: identifierField("trustAccount") });
const checkParam = z.object({ checkId: identifierPathParam("trustCheck", "checkId") });

const checksRoute = defineOpenAPIRoute(trustCheckReadMeta("trust.checks"), {
  method: "get",
  path: "/api/v1/trust/checks",
  description:
    "The account's checks: payments waiting to be printed, the register of every check number used with its status, the current check stock, and the next number. The register is the same read the reconciliation report's check register uses.",
  request: { query: trustAccountQuery },
  responses: {
    200: { description: "The checks", content: { "application/json": { schema: ChecksResponse } } },
    401: trustCheckErrors[401],
    403: trustCheckErrors[403],
    404: trustCheckErrors[404],
    422: trustCheckErrors[422],
    429: trustCheckErrors[429],
  },
});

const printRoute = defineOpenAPIRoute(trustCheckWriteMeta("trust.printChecks"), {
  method: "post",
  path: "/api/v1/trust/checks/print",
  description:
    "Numbers the chosen payments from the account's next check number, in the order given, and returns what each check says. The browser composes the PDF. Printing moves no money: the payment was approved when it was recorded.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: PrintRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The numbered checks",
      content: { "application/json": { schema: PrintResponse } },
    },
    400: trustCheckErrors[400],
    401: trustCheckErrors[401],
    403: trustCheckErrors[403],
    404: trustCheckErrors[404],
    409: trustCheckErrors[409],
    422: trustCheckErrors[422],
    429: trustCheckErrors[429],
  },
});

const resultsRoute = defineOpenAPIRoute(trustCheckWriteMeta("trust.recordCheckResults"), {
  method: "post",
  path: "/api/v1/trust/checks/results",
  description:
    "Says which checks of a print came out right and which were spoiled. A spoiled check keeps its number in the register and its payment goes back to the print queue.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: ResultsRequest } }, required: true },
  },
  responses: {
    201: { description: "Recorded", content: { "application/json": { schema: Acknowledgement } } },
    400: trustCheckErrors[400],
    401: trustCheckErrors[401],
    403: trustCheckErrors[403],
    404: trustCheckErrors[404],
    409: trustCheckErrors[409],
    422: trustCheckErrors[422],
    429: trustCheckErrors[429],
  },
});

const voidRoute = defineOpenAPIRoute(trustCheckWriteMeta("trust.voidCheck"), {
  method: "post",
  path: "/api/v1/trust/checks/{checkId}/void",
  description:
    "Voids a check with a reason. The number stays in the register and the payment returns to the print queue for a replacement. Voiding never reverses the payment; cancelling a payment is a trust movement under the authorization policy.",
  request: {
    headers: idempotencyKeyHeader,
    params: checkParam,
    body: { content: { "application/json": { schema: VoidRequest } }, required: true },
  },
  responses: {
    201: { description: "Voided", content: { "application/json": { schema: Acknowledgement } } },
    400: trustCheckErrors[400],
    401: trustCheckErrors[401],
    403: trustCheckErrors[403],
    404: trustCheckErrors[404],
    409: trustCheckErrors[409],
    422: trustCheckErrors[422],
    429: trustCheckErrors[429],
  },
});

const voidNumberRoute = defineOpenAPIRoute(trustCheckWriteMeta("trust.voidNextCheckNumber"), {
  method: "post",
  path: "/api/v1/trust/checks/void-next-number",
  description:
    "Voids the next unused check number with no payment, for a sheet torn or lost before printing, so the register matches the paper again.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: VoidRequest } }, required: true },
  },
  responses: {
    201: { description: "Voided", content: { "application/json": { schema: Acknowledgement } } },
    400: trustCheckErrors[400],
    401: trustCheckErrors[401],
    403: trustCheckErrors[403],
    404: trustCheckErrors[404],
    409: trustCheckErrors[409],
    422: trustCheckErrors[422],
    429: trustCheckErrors[429],
  },
});

// ---- records -------------------------------------------------------------------------------------

function toPrintRecord(item: TrustCheckToPrint): z.infer<typeof CheckToPrint> {
  return {
    trustMovementId: item.movementId,
    payee: item.payee,
    amountMinor: item.amountMinor,
    currency: item.currency,
    memo: item.purpose,
    effectiveDate: item.effectiveDate,
    authorizedBy: item.authorizedBy,
    matterNumber: item.matterNumber,
    matterTitle: item.matterTitle,
    earlierCheckNumbers: [...item.earlierCheckNumbers],
  };
}

function registerRecord(row: TrustCheckRegisterRow): z.infer<typeof RegisterRow> {
  return {
    trustCheckId: row.checkId,
    checkNumber: row.checkNumber,
    status: row.status,
    trustMovementId: row.movementId,
    payee: row.payee,
    amountMinor: row.amountMinor,
    currency: row.currency,
    effectiveDate: row.effectiveDate,
    matterNumber: row.matterNumber,
    matterTitle: row.matterTitle,
    memo: row.memo,
    numberedBy: row.numberedBy,
    numberedAt: row.numberedAt,
    settledReason: row.settledReason,
    lastEventAt: row.lastEventAt,
  };
}

export function registerTrustCheckRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // GET /api/v1/trust/checks
  app.openapi(
    { ...checksRoute, middleware: chokepointMiddleware(chokepoint, checksRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { trustAccountId } = c.req.valid("query");
      const accountId = trustAccountId as TrustAccountId;
      try {
        await loadTrustAccount(firm.firmDatabase, accountId);
        const stock = await readCurrentTrustCheckStock(firm.firmDatabase, accountId);
        const [nextCheckNumber, toPrint, register] = await Promise.all([
          readNextTrustCheckNumber(firm.firmDatabase, accountId, stock),
          readTrustChecksToPrint(firm.firmDatabase, accountId),
          readTrustCheckRegister(firm.firmDatabase, accountId),
        ]);
        return c.json(
          {
            nextCheckNumber,
            stock: stock === null ? null : trustCheckStockRecord(stock),
            toPrint: toPrint.map(toPrintRecord),
            register: register.map(registerRecord),
          },
          200,
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
    },
  );

  // POST /api/v1/trust/checks/print
  app.openapi(
    { ...printRoute, middleware: chokepointMiddleware(chokepoint, printRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      return commitTrustCheckWrite<z.infer<typeof PrintResponse>>(c, async (numberedBy) => {
        const composed = await composeTrustCheckPrint(
          firm.firmDatabase,
          {
            trustAccountId: request.trustAccountId as TrustAccountId,
            movementIds: request.trustMovementIds as TrustMovementId[],
            numberedBy,
          },
          trustCheckOptions(),
        );
        return {
          write: composed.effect,
          body: {
            stock: trustCheckStockRecord(composed.stock),
            checks: composed.checks.map((check) => ({
              trustCheckId: check.checkId,
              checkNumber: check.checkNumber,
              trustMovementId: check.item.movementId,
              payee: check.item.payee,
              amountMinor: check.item.amountMinor,
              currency: check.item.currency,
              effectiveDate: check.item.effectiveDate,
              memo: check.item.purpose,
              matterNumber: check.item.matterNumber,
              matterTitle: check.item.matterTitle,
            })),
          },
        };
      });
    },
  );

  // POST /api/v1/trust/checks/results
  app.openapi(
    { ...resultsRoute, middleware: chokepointMiddleware(chokepoint, resultsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      return commitTrustCheckWrite<z.infer<typeof Acknowledgement>>(c, async (recordedBy) => {
        const composed = await composeTrustCheckResults(
          firm.firmDatabase,
          {
            trustAccountId: request.trustAccountId as TrustAccountId,
            results: request.results.map((result) => ({
              checkId: result.trustCheckId as TrustCheckId,
              outcome: result.outcome,
              reason: result.reason ?? null,
            })),
            recordedBy,
          },
          trustCheckOptions(),
        );
        return {
          write: composed.effect,
          body: { recorded: composed.eventIds.length, checkNumber: null },
        };
      });
    },
  );

  // POST /api/v1/trust/checks/void-next-number — registered before the {checkId} pattern
  app.openapi(
    { ...voidNumberRoute, middleware: chokepointMiddleware(chokepoint, voidNumberRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      return commitTrustCheckWrite<z.infer<typeof Acknowledgement>>(c, async (recordedBy) => {
        const composed = await composeTrustCheckNumberVoid(
          firm.firmDatabase,
          {
            trustAccountId: request.trustAccountId as TrustAccountId,
            reason: request.reason,
            recordedBy,
          },
          trustCheckOptions(),
        );
        return { write: composed.effect, body: { recorded: 1, checkNumber: composed.checkNumber } };
      });
    },
  );

  // POST /api/v1/trust/checks/{checkId}/void
  app.openapi(
    { ...voidRoute, middleware: chokepointMiddleware(chokepoint, voidRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { checkId } = c.req.valid("param");
      const request = c.req.valid("json");
      return commitTrustCheckWrite<z.infer<typeof Acknowledgement>>(c, async (recordedBy) => {
        const composed = await composeTrustCheckVoid(
          firm.firmDatabase,
          {
            trustAccountId: request.trustAccountId as TrustAccountId,
            checkId: checkId as TrustCheckId,
            reason: request.reason,
            recordedBy,
          },
          trustCheckOptions(),
        );
        return { write: composed.effect, body: { recorded: 1, checkNumber: null } };
      });
    },
  );
}
