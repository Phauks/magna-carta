import { todayInUtc } from "@magna-carta/civil-time/civil-date";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { readImageFacts } from "@magna-carta/document-assembly/ooxml-image";
import { identifierField } from "@magna-carta/identifiers/field";
import type { TrustAccountId, TrustCheckId, TrustMovementId, UserId } from "@magna-carta/identifiers/types";
import { firmScopedObjectDimensions } from "@magna-carta/object-dimensions/dimensions";
import {
  CHECK_FIELD_ALIGNMENTS,
  CHECK_FIELD_KINDS,
  CHECK_PAGE_LAYOUTS,
} from "@magna-carta/trust/check-layout";
import {
  composeTrustCheckNumberVoid,
  composeTrustCheckPrint,
  composeTrustCheckResults,
  composeTrustCheckStockSave,
  composeTrustCheckVoid,
  isTrustCheckNumberConflict,
  readCurrentTrustCheckStock,
  readNextTrustCheckNumber,
  readTrustCheckRegister,
  readTrustChecksToPrint,
  type TrustCheckRegisterRow,
  type TrustCheckStockSnapshot,
  type TrustCheckToPrint,
} from "@magna-carta/trust/checks";
import { loadTrustAccount } from "@magna-carta/trust/account-tree";
import { TrustValidationError } from "@magna-carta/trust/trust-validation";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
import { decodeBase64, imageResponse, sha256Hex } from "../shared/image-bytes.ts";

// CHECK PRINTING: the queue of payments waiting for a check, the register of every number used,
// the stock that says where each field prints, and the scan of a blank check that stock is placed
// over. The rules are @magna-carta/trust's (src/checks.ts) and the migration's triggers; this module
// composes, commits and answers.
//
// The server never makes the PDF. A print request numbers the checks and returns what each one
// says; the browser composes the PDF from that in a Web Worker. So a print is a small write, and the
// CPU work of laying out pages stays off the request path.

const READ = "trust:read" as const;
const MANAGE = "trust:manage" as const;

/** Where a stock's scan lives in the firm's bucket, under its account. */
const SCAN_PREFIX = "trust-check-scan/";

const problem = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: Problem } },
});

const errors = {
  400: problem("Missing Idempotency-Key (this operation requires one)"),
  401: problem("No valid session"),
  403: problem("The session member lacks the capability"),
  404: problem("The trust account or check is unknown"),
  409: problem("The check was already answered, or the Idempotency-Key is still in progress"),
  422: problem("The trust rules refuse this"),
  429: problem("Rate limit exceeded"),
} as const;

function writeMeta(operationId: string): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission: MANAGE,
    resource: "firm",
    audited: true,
    // A retried print that numbered its checks twice would put two numbers on one payment.
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

function readMeta(operationId: string): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission: READ,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

const trustAccountQuery = z.object({ trustAccountId: identifierField("trustAccount") });
const checkParam = z.object({ checkId: identifierPathParam("trustCheck", "checkId") });

const CheckField = z
  .object({
    kind: z.enum(CHECK_FIELD_KINDS),
    xMils: z.number().int(),
    yMils: z.number().int(),
    widthMils: z.number().int(),
    sizePoints: z.number(),
    align: z.enum(CHECK_FIELD_ALIGNMENTS),
  })
  .openapi("TrustCheckField");

const CheckStock = z
  .object({
    trustCheckStockId: z.string(),
    version: z.number().int(),
    name: z.string(),
    pageLayout: z.enum(CHECK_PAGE_LAYOUTS),
    fields: z.array(CheckField),
    shiftXMils: z.number().int(),
    shiftYMils: z.number().int(),
    startingCheckNumber: z.number().int(),
    hasScan: z.boolean(),
    savedBy: z.string(),
    savedAt: z.string(),
  })
  .openapi("TrustCheckStock");

const CheckToPrint = z
  .object({
    trustMovementId: z.string(),
    payee: z.string(),
    amountMinor: z.number().int(),
    currency: z.string(),
    memo: z.string(),
    effectiveDate: z.string(),
    authorizedBy: z.string().nullable(),
    matterNumber: z.string().nullable(),
    matterTitle: z.string().nullable(),
    earlierCheckNumbers: z.array(z.number().int()),
  })
  .openapi("TrustCheckToPrint");

const CheckStatus = z.enum(["numbered", "printed", "spoiled", "voided"]);

const RegisterRow = z
  .object({
    trustCheckId: z.string(),
    checkNumber: z.number().int(),
    status: CheckStatus,
    trustMovementId: z.string().nullable(),
    payee: z.string().nullable(),
    amountMinor: z.number().int().nullable(),
    currency: z.string().nullable(),
    effectiveDate: z.string().nullable(),
    matterNumber: z.string().nullable(),
    matterTitle: z.string().nullable(),
    memo: z.string().nullable(),
    numberedBy: z.string(),
    numberedAt: z.string(),
    settledReason: z.string().nullable(),
    lastEventAt: z.string().nullable(),
  })
  .openapi("TrustCheckRegisterRow");

const ChecksResponse = z
  .object({
    nextCheckNumber: z.number().int(),
    stock: CheckStock.nullable(),
    toPrint: z.array(CheckToPrint),
    register: z.array(RegisterRow),
  })
  .openapi("TrustChecksResponse");

const PrintRequest = z
  .object({
    trustAccountId: identifierField("trustAccount"),
    trustMovementIds: z.array(identifierField("trustMovement")).min(1).max(100),
  })
  .openapi("PrintTrustChecksRequest");

const PrintedCheck = z
  .object({
    trustCheckId: z.string(),
    checkNumber: z.number().int(),
    trustMovementId: z.string(),
    payee: z.string(),
    amountMinor: z.number().int(),
    currency: z.string(),
    effectiveDate: z.string(),
    memo: z.string(),
    matterNumber: z.string().nullable(),
    matterTitle: z.string().nullable(),
  })
  .openapi("PrintedTrustCheck");

const PrintResponse = z
  .object({ stock: CheckStock, checks: z.array(PrintedCheck) })
  .openapi("PrintTrustChecksResponse");

const ResultsRequest = z
  .object({
    trustAccountId: identifierField("trustAccount"),
    results: z
      .array(
        z.object({
          trustCheckId: identifierField("trustCheck"),
          outcome: z.enum(["printed", "spoiled"]),
          reason: z.string().max(500).nullish(),
        }),
      )
      .min(1)
      .max(100),
  })
  .openapi("RecordTrustCheckResultsRequest");

const VoidRequest = z
  .object({ trustAccountId: identifierField("trustAccount"), reason: z.string().min(1).max(500) })
  .openapi("VoidTrustCheckRequest");

const Acknowledgement = z
  .object({ recorded: z.number().int(), checkNumber: z.number().int().nullable() })
  .openapi("TrustCheckAcknowledgement");

const SaveStockRequest = z
  .object({
    trustAccountId: identifierField("trustAccount"),
    name: z.string().min(1).max(120),
    pageLayout: z.enum(CHECK_PAGE_LAYOUTS),
    fields: z.array(CheckField).min(1).max(12),
    shiftXMils: z.number().int(),
    shiftYMils: z.number().int(),
    startingCheckNumber: z.number().int().min(1),
    // `keep` holds on to the current version's scan, `remove` drops it, and an image replaces it.
    // The image is base64 of a PNG or JPEG the browser has already straightened.
    scan: z.union([
      z.literal("keep"),
      z.literal("remove"),
      z.object({ imageBase64: z.string().min(1) }),
    ]),
  })
  .openapi("SaveTrustCheckStockRequest");

const SaveStockResponse = z
  .object({ stock: CheckStock, nextCheckNumber: z.number().int() })
  .openapi("SaveTrustCheckStockResponse");

const checksRoute = defineOpenAPIRoute(readMeta("trust.checks"), {
  method: "get",
  path: "/api/v1/trust/checks",
  description:
    "The account's checks: payments waiting to be printed, the register of every check number used with its status, the current check stock, and the next number. The register is the same read the reconciliation report's check register uses.",
  request: { query: trustAccountQuery },
  responses: {
    200: { description: "The checks", content: { "application/json": { schema: ChecksResponse } } },
    401: errors[401],
    403: errors[403],
    404: errors[404],
    422: errors[422],
    429: errors[429],
  },
});

const printRoute = defineOpenAPIRoute(writeMeta("trust.printChecks"), {
  method: "post",
  path: "/api/v1/trust/checks/print",
  description:
    "Numbers the chosen payments from the account's next check number, in the order given, and returns what each check says. The browser composes the PDF. Printing moves no money: the payment was approved when it was recorded.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: PrintRequest } }, required: true },
  },
  responses: {
    201: { description: "The numbered checks", content: { "application/json": { schema: PrintResponse } } },
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

const resultsRoute = defineOpenAPIRoute(writeMeta("trust.recordCheckResults"), {
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
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

const voidRoute = defineOpenAPIRoute(writeMeta("trust.voidCheck"), {
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
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

const voidNumberRoute = defineOpenAPIRoute(writeMeta("trust.voidNextCheckNumber"), {
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
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

const saveStockRoute = defineOpenAPIRoute(writeMeta("trust.saveCheckStock"), {
  method: "post",
  path: "/api/v1/trust/check-stock",
  description:
    "Saves a new version of the account's check stock: the page layout, where each field prints, a whole-page shift, the first number of the box in the printer, and optionally a scan of a blank check to place the fields over. No field may reach the MICR band.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: SaveStockRequest } }, required: true },
  },
  responses: {
    201: { description: "Saved", content: { "application/json": { schema: SaveStockResponse } } },
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

const scanRoute = defineOpenAPIRoute(readMeta("trust.checkStockScan"), {
  method: "get",
  path: "/api/v1/trust/check-stock/scan",
  description:
    "The scan of a blank check behind the account's current stock. Rides the session like every other read and is never publicly addressable.",
  request: { query: trustAccountQuery },
  responses: {
    200: {
      description: "The image",
      content: { "image/png": { schema: z.string() }, "image/jpeg": { schema: z.string() } },
    },
    401: errors[401],
    403: errors[403],
    404: errors[404],
    429: errors[429],
  },
});

// ---- records -------------------------------------------------------------------------------------

function stockRecord(stock: TrustCheckStockSnapshot): z.infer<typeof CheckStock> {
  return {
    trustCheckStockId: stock.id,
    version: stock.version,
    name: stock.name,
    pageLayout: stock.pageLayout,
    fields: stock.fields.map((field) => ({ ...field })),
    shiftXMils: stock.shiftXMils,
    shiftYMils: stock.shiftYMils,
    startingCheckNumber: stock.startingCheckNumber,
    hasScan: stock.scanObjectKey !== null,
    savedBy: stock.savedBy,
    savedAt: stock.savedAt,
  };
}

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

function checkErrorResponse(
  c: Context,
  error: TrustValidationError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  if (error.code === "unknown-trust-account" || error.code === "unknown-trust-check") {
    return problemJson(c, { type: "not-found", title: "Not found", status: 404, detail: error.message });
  }
  if (error.code === "check-already-answered") {
    return problemJson(c, {
      type: "trust-check-already-answered",
      title: "That check has already been answered",
      status: 409,
      detail: error.message,
    });
  }
  return problemJson(c, {
    type: "trust-check-refused",
    title: "The trust rules refuse this",
    status: 422,
    detail: error.message,
  });
}

type ChecksApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

const trustOptions = () => ({
  clock: {
    now: () => new Date().toISOString(),
    today: () => todayInUtc(),
  },
});

export function registerTrustCheckRoutes(app: ChecksApp, chokepoint: Chokepoint): void {
  async function commitWrite<Body>(
    c: Context,
    compose: (actor: UserId) => Promise<{ write: EffectWrite; body: Body }>,
  ) {
    const firm = requireChokepointFirmContext(c);
    const userId = requireChokepointUserId(c);
    const idempotency = requireChokepointIdempotency(c);
    const attempt = () =>
      runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now: () => new Date().toISOString(),
        effect: async () => {
          const composed = await compose(userId);
          return {
            write: composed.write,
            responseCode: 201,
            responseBody: canonicalJsonStringify(composed.body),
          };
        },
      });
    let result;
    try {
      try {
        result = await attempt();
      } catch (caught) {
        // Two people printing at once read the same next number; the loser's batch aborted whole
        // on the unique index, so reading again gives it the numbers after the winner's.
        if (!isTrustCheckNumberConflict(caught)) throw caught;
        result = await attempt();
      }
    } catch (caught) {
      if (caught instanceof TrustValidationError) return checkErrorResponse(c, caught);
      if (isTrustCheckNumberConflict(caught)) {
        return problemJson(c, {
          type: "trust-check-number-taken",
          title: "Someone else is printing checks on this account",
          status: 409,
          detail: "Another print took the same check numbers. Print again.",
        });
      }
      throw caught;
    }
    if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
      return problemResponseForIdempotencyConflict(c, result);
    }
    if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
    return c.json(JSON.parse(result.responseBody ?? "{}") as Body, 201);
  }

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
            stock: stock === null ? null : stockRecord(stock),
            toPrint: toPrint.map(toPrintRecord),
            register: register.map(registerRecord),
          },
          200,
        );
      } catch (caught) {
        if (caught instanceof TrustValidationError) {
          return problemJson(c, { type: "not-found", title: "Not found", status: 404, detail: caught.message });
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
      return commitWrite<z.infer<typeof PrintResponse>>(c, async (numberedBy) => {
        const composed = await composeTrustCheckPrint(
          firm.firmDatabase,
          {
            trustAccountId: request.trustAccountId as TrustAccountId,
            movementIds: request.trustMovementIds as TrustMovementId[],
            numberedBy,
          },
          trustOptions(),
        );
        return {
          write: composed.effect,
          body: {
            stock: stockRecord(composed.stock),
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
      return commitWrite<z.infer<typeof Acknowledgement>>(c, async (recordedBy) => {
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
          trustOptions(),
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
      return commitWrite<z.infer<typeof Acknowledgement>>(c, async (recordedBy) => {
        const composed = await composeTrustCheckNumberVoid(
          firm.firmDatabase,
          {
            trustAccountId: request.trustAccountId as TrustAccountId,
            reason: request.reason,
            recordedBy,
          },
          trustOptions(),
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
      return commitWrite<z.infer<typeof Acknowledgement>>(c, async (recordedBy) => {
        const composed = await composeTrustCheckVoid(
          firm.firmDatabase,
          {
            trustAccountId: request.trustAccountId as TrustAccountId,
            checkId: checkId as TrustCheckId,
            reason: request.reason,
            recordedBy,
          },
          trustOptions(),
        );
        return { write: composed.effect, body: { recorded: 1, checkNumber: null } };
      });
    },
  );

  // POST /api/v1/trust/check-stock
  app.openapi(
    { ...saveStockRoute, middleware: chokepointMiddleware(chokepoint, saveStockRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      const accountId = request.trustAccountId as TrustAccountId;

      // The scan's bytes go to the bucket BEFORE the row that names them, so a row never points at
      // nothing. The key is the content's hash, so a retry writes the same object.
      let scan: { objectKey: string; sha256: string } | null | "keep" = "keep";
      if (request.scan === "remove") scan = null;
      else if (typeof request.scan === "object") {
        const bytes = decodeBase64(request.scan.imageBase64);
        const facts = bytes === undefined ? undefined : readImageFacts(bytes);
        if (bytes === undefined || facts === undefined || !facts.ok) {
          return problemJson(c, {
            type: "validation",
            title: "Not a usable picture",
            status: 422,
            detail: "The scan is not a readable PNG or JPEG.",
          });
        }
        const digest = await sha256Hex(bytes);
        const objectKey = `${SCAN_PREFIX}${accountId}/${digest}.${facts.value.extension}`;
        const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
        await bucket.put(objectKey, bytes, {
          sha256: digest,
          customMetadata: firmScopedObjectDimensions("check-stock-scan"),
        });
        scan = { objectKey, sha256: digest };
      }

      return commitWrite<z.infer<typeof SaveStockResponse>>(c, async (savedBy) => {
        let keptScan: { objectKey: string; sha256: string } | null = null;
        if (scan === "keep") {
          const current = await readCurrentTrustCheckStock(firm.firmDatabase, accountId);
          keptScan =
            current?.scanObjectKey != null && current.scanSha256 != null
              ? { objectKey: current.scanObjectKey, sha256: current.scanSha256 }
              : null;
        } else keptScan = scan;
        const composed = await composeTrustCheckStockSave(
          firm.firmDatabase,
          {
            trustAccountId: accountId,
            name: request.name,
            pageLayout: request.pageLayout,
            fields: request.fields,
            shiftXMils: request.shiftXMils,
            shiftYMils: request.shiftYMils,
            startingCheckNumber: request.startingCheckNumber,
            scan: keptScan,
            savedBy,
          },
          trustOptions(),
        );
        const saved: TrustCheckStockSnapshot = {
          id: composed.stockId,
          trustAccountId: accountId,
          version: composed.version,
          name: request.name.trim(),
          pageLayout: request.pageLayout,
          fields: request.fields,
          shiftXMils: request.shiftXMils,
          shiftYMils: request.shiftYMils,
          startingCheckNumber: request.startingCheckNumber,
          scanObjectKey: keptScan?.objectKey ?? null,
          scanSha256: keptScan?.sha256 ?? null,
          savedBy,
          savedAt: new Date().toISOString(),
        };
        const nextCheckNumber = await readNextTrustCheckNumber(firm.firmDatabase, accountId, saved);
        return { write: composed.effect, body: { stock: stockRecord(saved), nextCheckNumber } };
      });
    },
  );

  // GET /api/v1/trust/check-stock/scan
  app.openapi(
    { ...scanRoute, middleware: chokepointMiddleware(chokepoint, scanRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { trustAccountId } = c.req.valid("query");
      const stock = await readCurrentTrustCheckStock(firm.firmDatabase, trustAccountId as TrustAccountId);
      const key = stock?.scanObjectKey ?? null;
      const contentType = key?.endsWith(".png") ? "image/png" : "image/jpeg";
      const response =
        key === null
          ? null
          : await imageResponse(resolveFirmBucket(c.env, firm.bucketName).bucket, key, contentType);
      if (response === null) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "This account's check stock has no scan.",
        });
      }
      return response;
    },
  );
}
