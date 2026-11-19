import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { todayInUtc } from "@magna-carta/civil-time/civil-date";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { GuardedWriteRefusedError, type EffectWrite } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { identifierField } from "@magna-carta/identifiers/field";
import type {
  LedgerEntryId,
  TrustAccountId,
  TrustBankReconciliationChangeId,
  TrustBankReconciliationFileId,
  TrustBankReconciliationId,
  TrustBankReconciliationInterestId,
  TrustBankReconciliationRestorePointId,
  UserId,
} from "@magna-carta/identifiers/types";
import { firmScopedObjectDimensions } from "@magna-carta/object-dimensions/dimensions";
import {
  composeTrustBankReconciliationEdits,
  composeTrustBankReconciliationFile,
  composeTrustBankReconciliationFileRemoval,
  composeTrustBankReconciliationFinish,
  composeTrustBankReconciliationInterest,
  composeTrustBankReconciliationInterestRemoval,
  composeTrustBankReconciliationNote,
  composeTrustBankReconciliationRestore,
  composeTrustBankReconciliationRevert,
  composeTrustBankReconciliationSave,
  composeTrustBankReconciliationStart,
  inverseOfChange,
  readNextBankReconciliationStart,
  readTrustBankReconciliation,
  readTrustBankReconciliationFile,
  readTrustBankReconciliations,
  undoRedoTargets,
  type BankReconciliationDetail,
  type BankReconciliationEdit,
  type BankReconciliationHeader,
  type BankReconciliationLineKey,
  type BankReconciliationSummary,
} from "@magna-carta/trust/bank-reconciliation";
import {
  BankReconciliationAcknowledgement,
  BankReconciliationDetailResponse,
  BankReconciliationEditsRequest,
  BankReconciliationFileRequest,
  BankReconciliationInterestRequest,
  BankReconciliationListResponse,
  BankReconciliationNoteRequest,
  BankReconciliationRestoreRequest,
  BankReconciliationRevertRequest,
  BankReconciliationSaveRequest,
  MAX_BANK_RECONCILIATION_FILE_BYTES,
  StartBankReconciliationRequest,
  StartBankReconciliationResponse,
  type BankReconciliationHeaderRecord,
  type BankReconciliationLine,
} from "@magna-carta/trust/bank-reconciliation-contract";
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
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
import { decodeBase64, sha256Hex } from "../shared/image-bytes.ts";

// BANK RECONCILIATION: the list of periods on an account, one period with its book items, and every
// change a person makes to it. The rules are @magna-carta/trust's (src/bank-reconciliation.ts) and
// the migration's triggers; this module composes, commits and answers. A write answers with a short
// acknowledgement and the screen reads the period again, which is also how it sees other people's
// changes while they work.

/** Where a period's files live in the firm's bucket, under its id. */
const FILE_PREFIX = "trust-reconciliation-file/";

const READ = "trust:read" as const;
const MANAGE = "trust:manage" as const;

const problem = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: Problem } },
});

const errors = {
  400: problem("Missing Idempotency-Key (this operation requires one)"),
  401: problem("No valid session"),
  403: problem("The session member lacks the capability"),
  404: problem("The trust account, reconciliation or file is unknown"),
  409: problem(
    "The reconciliation changed or finished, or the Idempotency-Key is still in progress",
  ),
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
    // A retried tick would land twice in History.
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

const options = () => ({
  clock: { now: () => new Date().toISOString(), today: () => todayInUtc() },
});

const trustAccountQuery = z.object({ trustAccountId: identifierField("trustAccount") });
const reconciliationParam = z.object({
  reconciliationId: identifierPathParam("trustBankReconciliation", "reconciliationId"),
});
const interestParam = reconciliationParam.extend({
  interestId: identifierPathParam("trustBankReconciliationInterest", "interestId"),
});
const fileParam = reconciliationParam.extend({
  fileId: identifierPathParam("trustBankReconciliationFile", "fileId"),
});

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const body = <T extends z.ZodType>(schema: T) => ({
  content: { "application/json": { schema } },
  required: true,
});

const acknowledged = json(BankReconciliationAcknowledgement, "Saved");

const listRoute = defineOpenAPIRoute(readMeta("trust.listBankReconciliations"), {
  method: "get",
  path: "/api/v1/trust/bank-reconciliations",
  description:
    "Every reconciliation on the account, newest first, with its figures, and where the next one starts.",
  request: { query: trustAccountQuery },
  responses: {
    200: json(BankReconciliationListResponse, "The reconciliations"),
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

const startRoute = defineOpenAPIRoute(writeMeta("trust.startBankReconciliation"), {
  method: "post",
  path: "/api/v1/trust/bank-reconciliations",
  description:
    "Starts a reconciliation. The first one on an account takes its start date and balance from the statement; after that they carry over from the last finished one. One may be in progress per account.",
  request: { headers: idempotencyKeyHeader, body: body(StartBankReconciliationRequest) },
  responses: {
    201: json(StartBankReconciliationResponse, "Started"),
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

const getRoute = defineOpenAPIRoute(readMeta("trust.getBankReconciliation"), {
  method: "get",
  path: "/api/v1/trust/bank-reconciliations/{reconciliationId}",
  description:
    "One reconciliation: its book items with what is ticked, the figures, IOLTA interest, notes, files, History and restore points.",
  request: { params: reconciliationParam },
  responses: {
    200: json(BankReconciliationDetailResponse, "The reconciliation"),
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

const editsRoute = defineOpenAPIRoute(writeMeta("trust.editBankReconciliation"), {
  method: "post",
  path: "/api/v1/trust/bank-reconciliations/{reconciliationId}/changes",
  description: "Ticks or unticks lines, or changes the end date or end balance, in order.",
  request: {
    headers: idempotencyKeyHeader,
    params: reconciliationParam,
    body: body(BankReconciliationEditsRequest),
  },
  responses: {
    201: acknowledged,
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

const revertRoute = defineOpenAPIRoute(writeMeta("trust.revertBankReconciliationChange"), {
  method: "post",
  path: "/api/v1/trust/bank-reconciliations/{reconciliationId}/revert",
  description:
    "Undo or Redo the caller's own last change, or undo any one change from History. Each writes a new change; nothing is erased.",
  request: {
    headers: idempotencyKeyHeader,
    params: reconciliationParam,
    body: body(BankReconciliationRevertRequest),
  },
  responses: {
    201: acknowledged,
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

const saveRoute = defineOpenAPIRoute(writeMeta("trust.saveBankReconciliation"), {
  method: "post",
  path: "/api/v1/trust/bank-reconciliations/{reconciliationId}/restore-points",
  description: "Save: a named restore point at the latest change.",
  request: {
    headers: idempotencyKeyHeader,
    params: reconciliationParam,
    body: body(BankReconciliationSaveRequest),
  },
  responses: {
    201: acknowledged,
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

const restoreRoute = defineOpenAPIRoute(writeMeta("trust.restoreBankReconciliation"), {
  method: "post",
  path: "/api/v1/trust/bank-reconciliations/{reconciliationId}/restore",
  description:
    "Puts the ticks, end date and end balance back as they were at a restore point, saving the current place first. Notes and files are kept.",
  request: {
    headers: idempotencyKeyHeader,
    params: reconciliationParam,
    body: body(BankReconciliationRestoreRequest),
  },
  responses: {
    201: acknowledged,
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

const interestRoute = defineOpenAPIRoute(writeMeta("trust.addBankReconciliationInterest"), {
  method: "post",
  path: "/api/v1/trust/bank-reconciliations/{reconciliationId}/interest",
  description:
    "Adds IOLTA interest the bank credited, or its sweep to the bar foundation, ticked. It belongs to no matter and never touches a client ledger.",
  request: {
    headers: idempotencyKeyHeader,
    params: reconciliationParam,
    body: body(BankReconciliationInterestRequest),
  },
  responses: {
    201: acknowledged,
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

const interestRemovalRoute = defineOpenAPIRoute(
  writeMeta("trust.removeBankReconciliationInterest"),
  {
    method: "post",
    path: "/api/v1/trust/bank-reconciliations/{reconciliationId}/interest/{interestId}/removal",
    description: "Removes an IOLTA interest line added by mistake.",
    request: { headers: idempotencyKeyHeader, params: interestParam },
    responses: {
      201: acknowledged,
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: errors[404],
      409: errors[409],
      422: errors[422],
      429: errors[429],
    },
  },
);

const noteRoute = defineOpenAPIRoute(writeMeta("trust.addBankReconciliationNote"), {
  method: "post",
  path: "/api/v1/trust/bank-reconciliations/{reconciliationId}/notes",
  description:
    "Adds a note to a line, or marks it Needs review or resolved. Notes are never undone, and may be added after the reconciliation is finished.",
  request: {
    headers: idempotencyKeyHeader,
    params: reconciliationParam,
    body: body(BankReconciliationNoteRequest),
  },
  responses: {
    201: acknowledged,
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

const fileRoute = defineOpenAPIRoute(writeMeta("trust.attachBankReconciliationFile"), {
  method: "post",
  path: "/api/v1/trust/bank-reconciliations/{reconciliationId}/files",
  description:
    "Keeps a file with the reconciliation: the bank statement, a deposit slip. PDF, PNG or JPEG, up to 25 MB.",
  request: {
    headers: idempotencyKeyHeader,
    params: reconciliationParam,
    body: body(BankReconciliationFileRequest),
  },
  responses: {
    201: acknowledged,
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

const fileRemovalRoute = defineOpenAPIRoute(writeMeta("trust.removeBankReconciliationFile"), {
  method: "post",
  path: "/api/v1/trust/bank-reconciliations/{reconciliationId}/files/{fileId}/removal",
  description:
    "Takes a file off an in-progress reconciliation. The bytes are kept, as trust records are.",
  request: { headers: idempotencyKeyHeader, params: fileParam },
  responses: {
    201: acknowledged,
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

const fileReadRoute = defineOpenAPIRoute(readMeta("trust.bankReconciliationFile"), {
  method: "get",
  path: "/api/v1/trust/bank-reconciliations/{reconciliationId}/files/{fileId}",
  description: "A file kept with the reconciliation, as it was attached.",
  request: { params: fileParam },
  responses: {
    200: {
      description: "The file",
      content: {
        "application/pdf": { schema: z.string() },
        "image/png": { schema: z.string() },
        "image/jpeg": { schema: z.string() },
      },
    },
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

const finishRoute = defineOpenAPIRoute(writeMeta("trust.finishBankReconciliation"), {
  method: "post",
  path: "/api/v1/trust/bank-reconciliations/{reconciliationId}/finish",
  description:
    "Finishes the reconciliation: freezes its figures and the items it cleared. A difference is allowed and recorded as it stands. Refused if anyone changed it since it was last read.",
  request: { headers: idempotencyKeyHeader, params: reconciliationParam },
  responses: {
    201: acknowledged,
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

// ---- records -------------------------------------------------------------------------------------

function headerRecord(
  header: BankReconciliationHeader,
): z.infer<typeof BankReconciliationHeaderRecord> {
  return {
    trustBankReconciliationId: header.id,
    trustAccountId: header.trustAccountId,
    currency: header.currency,
    startDate: header.startDate,
    startBalanceMinor: header.startBalanceMinor,
    startCarriedOver: header.startCarriedOver,
    startedBy: header.startedBy,
    startedByName: header.startedByName,
    startedAt: header.startedAt,
    finishedBy: header.finishedBy,
    finishedByName: header.finishedByName,
    finishedAt: header.finishedAt,
  };
}

function lineRecord(line: BankReconciliationLineKey): z.infer<typeof BankReconciliationLine> {
  return line.kind === "entry"
    ? { kind: "entry", entryId: line.entryId }
    : { kind: "interest", interestId: line.interestId };
}

function lineKey(line: z.infer<typeof BankReconciliationLine>): BankReconciliationLineKey {
  return line.kind === "entry"
    ? { kind: "entry", entryId: line.entryId as LedgerEntryId }
    : { kind: "interest", interestId: line.interestId as TrustBankReconciliationInterestId };
}

function detailRecord(
  detail: BankReconciliationDetail,
  viewer: UserId,
): z.infer<typeof BankReconciliationDetailResponse> {
  const targets = undoRedoTargets(detail.changes, viewer);
  return {
    reconciliation: headerRecord(detail.reconciliation),
    endDate: detail.endDate,
    endBalanceMinor: detail.endBalanceMinor,
    figures: { ...detail.figures },
    items: detail.items.map((item) => ({ ...item })),
    interest: detail.interest.map(({ id, ...line }) => ({ interestId: id, ...line })),
    notes: detail.notes.map(({ id, line, ...note }) => ({
      noteId: id,
      line: lineRecord(line),
      ...note,
    })),
    files: detail.files.map((file) => ({
      fileId: file.id,
      name: file.name,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      recordedBy: file.recordedBy,
      recordedAt: file.recordedAt,
    })),
    changes: detail.changes.map(({ id, line, ...change }) => ({
      changeId: id,
      line: line === null ? null : lineRecord(line),
      ...change,
      canRevert:
        detail.reconciliation.finishedAt === null &&
        inverseOfChange(detail.changes, { id, line, ...change }) !== null,
    })),
    restorePoints: detail.restorePoints.map(({ id, ...point }) => ({
      restorePointId: id,
      ...point,
    })),
    undoChangeId: targets.undo?.id ?? null,
    redoChangeId: targets.redo?.id ?? null,
    version: detail.version,
  };
}

function summaryRecord(summary: BankReconciliationSummary) {
  return { ...summary, reconciliation: headerRecord(summary.reconciliation) };
}

// ---- answers -------------------------------------------------------------------------------------

function refusal(c: Context, error: TrustValidationError) {
  if (
    error.code === "unknown-trust-account" ||
    error.code === "unknown-trust-bank-reconciliation" ||
    error.code === "bank-reconciliation-unknown-file" ||
    error.code === "bank-reconciliation-unknown-restore-point"
  ) {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: error.message,
    });
  }
  if (
    error.code === "bank-reconciliation-finished" ||
    error.code === "bank-reconciliation-in-progress"
  ) {
    return problemJson(c, {
      type: "trust-bank-reconciliation-conflict",
      title: "This reconciliation can't change now",
      status: 409,
      detail: error.message,
    });
  }
  return problemJson(c, {
    type: "trust-bank-reconciliation-refused",
    title: "The trust rules refuse this",
    status: 422,
    detail: error.message,
  });
}

/** A batch refused by its guard: someone changed the period between the read and the finish. */
function isGuardRefusal(caught: unknown): boolean {
  return caught instanceof GuardedWriteRefusedError;
}

async function commitWrite<Body>(
  c: Context,
  compose: (actor: UserId) => Promise<{ write: EffectWrite; body: Body }>,
) {
  const firm = requireChokepointFirmContext(c);
  const userId = requireChokepointUserId(c);
  const idempotency = requireChokepointIdempotency(c);
  let result;
  try {
    result = await runIdempotentEffect({
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
  } catch (caught) {
    if (caught instanceof TrustValidationError) return refusal(c, caught);
    if (isGuardRefusal(caught)) {
      return problemJson(c, {
        type: "trust-bank-reconciliation-conflict",
        title: "Someone changed this reconciliation",
        status: 409,
        detail: "It changed while you were finishing. Check the figures and finish again.",
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

const ok = { ok: true as const };

/** What the bytes are, read from their first bytes, never from the name or the declared type. */
function sniffFile(bytes: Uint8Array): { contentType: string } | null {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return { contentType: "application/pdf" };
  if (starts(0x89, 0x50, 0x4e, 0x47)) return { contentType: "image/png" };
  if (starts(0xff, 0xd8, 0xff)) return { contentType: "image/jpeg" };
  return null;
}

export function registerTrustBankReconciliationRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const accountId = c.req.valid("query").trustAccountId as TrustAccountId;
      try {
        const [reconciliations, nextStart] = await Promise.all([
          readTrustBankReconciliations(firm.firmDatabase, accountId),
          readNextBankReconciliationStart(firm.firmDatabase, accountId),
        ]);
        return c.json({ reconciliations: reconciliations.map(summaryRecord), nextStart }, 200);
      } catch (caught) {
        if (caught instanceof TrustValidationError) return refusal(c, caught);
        throw caught;
      }
    },
  );

  app.openapi(
    { ...startRoute, middleware: chokepointMiddleware(chokepoint, startRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      return commitWrite(c, async (startedBy) => {
        const started = await composeTrustBankReconciliationStart(
          firm.firmDatabase,
          {
            trustAccountId: request.trustAccountId as TrustAccountId,
            startDate: request.startDate ?? null,
            startBalanceMinor: request.startBalanceMinor ?? null,
            endDate: request.endDate,
            endBalanceMinor: request.endBalanceMinor ?? null,
            startedBy,
          },
          options(),
        );
        return {
          write: started.effect,
          body: { trustBankReconciliationId: started.reconciliationId },
        };
      });
    },
  );

  app.openapi(
    { ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const viewer = requireChokepointUserId(c);
      const { reconciliationId } = c.req.valid("param");
      try {
        const detail = await readTrustBankReconciliation(
          firm.firmDatabase,
          reconciliationId as TrustBankReconciliationId,
        );
        return c.json(detailRecord(detail, viewer), 200);
      } catch (caught) {
        if (caught instanceof TrustValidationError) return refusal(c, caught);
        throw caught;
      }
    },
  );

  app.openapi(
    { ...editsRoute, middleware: chokepointMiddleware(chokepoint, editsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const id = c.req.valid("param").reconciliationId as TrustBankReconciliationId;
      const edits: BankReconciliationEdit[] = c.req
        .valid("json")
        .edits.map((edit) => (edit.kind === "tick" ? { ...edit, line: lineKey(edit.line) } : edit));
      return commitWrite(c, async (by) => ({
        write: (
          await composeTrustBankReconciliationEdits(firm.firmDatabase, id, edits, by, options())
        ).effect,
        body: ok,
      }));
    },
  );

  app.openapi(
    { ...revertRoute, middleware: chokepointMiddleware(chokepoint, revertRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const id = c.req.valid("param").reconciliationId as TrustBankReconciliationId;
      const request = c.req.valid("json");
      return commitWrite(c, async (by) => ({
        write: (
          await composeTrustBankReconciliationRevert(
            firm.firmDatabase,
            id,
            request.kind === "history"
              ? {
                  kind: "history",
                  changeId: request.changeId as TrustBankReconciliationChangeId,
                }
              : { kind: request.kind },
            by,
            options(),
          )
        ).effect,
        body: ok,
      }));
    },
  );

  app.openapi(
    { ...saveRoute, middleware: chokepointMiddleware(chokepoint, saveRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const id = c.req.valid("param").reconciliationId as TrustBankReconciliationId;
      const { name } = c.req.valid("json");
      return commitWrite(c, async (by) => ({
        write: (
          await composeTrustBankReconciliationSave(firm.firmDatabase, id, name, by, options())
        ).effect,
        body: ok,
      }));
    },
  );

  app.openapi(
    { ...restoreRoute, middleware: chokepointMiddleware(chokepoint, restoreRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const id = c.req.valid("param").reconciliationId as TrustBankReconciliationId;
      const { restorePointId } = c.req.valid("json");
      return commitWrite(c, async (by) => ({
        write: (
          await composeTrustBankReconciliationRestore(
            firm.firmDatabase,
            id,
            restorePointId as TrustBankReconciliationRestorePointId,
            by,
            options(),
          )
        ).effect,
        body: ok,
      }));
    },
  );

  app.openapi(
    { ...interestRoute, middleware: chokepointMiddleware(chokepoint, interestRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const id = c.req.valid("param").reconciliationId as TrustBankReconciliationId;
      const request = c.req.valid("json");
      return commitWrite(c, async (by) => ({
        write: (
          await composeTrustBankReconciliationInterest(
            firm.firmDatabase,
            id,
            request,
            by,
            options(),
          )
        ).effect,
        body: ok,
      }));
    },
  );

  app.openapi(
    { ...interestRemovalRoute, middleware: chokepointMiddleware(chokepoint, interestRemovalRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const params = c.req.valid("param");
      return commitWrite(c, async (by) => ({
        write: (
          await composeTrustBankReconciliationInterestRemoval(
            firm.firmDatabase,
            params.reconciliationId as TrustBankReconciliationId,
            params.interestId as TrustBankReconciliationInterestId,
            by,
            options(),
          )
        ).effect,
        body: ok,
      }));
    },
  );

  app.openapi(
    { ...noteRoute, middleware: chokepointMiddleware(chokepoint, noteRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const id = c.req.valid("param").reconciliationId as TrustBankReconciliationId;
      const request = c.req.valid("json");
      return commitWrite(c, async (by) => ({
        write: (
          await composeTrustBankReconciliationNote(
            firm.firmDatabase,
            id,
            { line: lineKey(request.line), kind: request.kind, body: request.body ?? null },
            by,
            options(),
          )
        ).effect,
        body: ok,
      }));
    },
  );

  app.openapi(
    { ...fileRoute, middleware: chokepointMiddleware(chokepoint, fileRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const id = c.req.valid("param").reconciliationId as TrustBankReconciliationId;
      const request = c.req.valid("json");
      const bytes = decodeBase64(request.dataBase64);
      const sniffed = bytes === undefined ? null : sniffFile(bytes);
      if (bytes === undefined || sniffed === null) {
        return problemJson(c, {
          type: "validation",
          title: "Not a PDF or picture",
          status: 422,
          detail: "Attach a PDF, PNG or JPEG file.",
        });
      }
      if (bytes.byteLength > MAX_BANK_RECONCILIATION_FILE_BYTES) {
        return problemJson(c, {
          type: "validation",
          title: "File too large",
          status: 422,
          detail: "Attach a file of 25 MB or less.",
        });
      }
      // The bytes go to the bucket BEFORE the row that names them, so a row never points at nothing.
      // The key is the content's hash, so a retry writes the same object.
      const digest = await sha256Hex(bytes);
      const objectKey = `${FILE_PREFIX}${id}/${digest}`;
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
      await bucket.put(objectKey, bytes, {
        sha256: digest,
        httpMetadata: { contentType: sniffed.contentType },
        customMetadata: firmScopedObjectDimensions("trust-reconciliation-file"),
      });
      return commitWrite(c, async (by) => ({
        write: (
          await composeTrustBankReconciliationFile(
            firm.firmDatabase,
            id,
            {
              name: request.name,
              contentType: sniffed.contentType,
              sizeBytes: bytes.byteLength,
              objectKey,
              sha256: digest,
            },
            by,
            options(),
          )
        ).effect,
        body: ok,
      }));
    },
  );

  app.openapi(
    { ...fileRemovalRoute, middleware: chokepointMiddleware(chokepoint, fileRemovalRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const params = c.req.valid("param");
      return commitWrite(c, async (by) => ({
        write: (
          await composeTrustBankReconciliationFileRemoval(
            firm.firmDatabase,
            params.reconciliationId as TrustBankReconciliationId,
            params.fileId as TrustBankReconciliationFileId,
            by,
            options(),
          )
        ).effect,
        body: ok,
      }));
    },
  );

  app.openapi(
    { ...fileReadRoute, middleware: chokepointMiddleware(chokepoint, fileReadRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const params = c.req.valid("param");
      const file = await readTrustBankReconciliationFile(
        firm.firmDatabase,
        params.reconciliationId as TrustBankReconciliationId,
        params.fileId as TrustBankReconciliationFileId,
      );
      const object =
        file === null
          ? null
          : await resolveFirmBucket(c.env, firm.bucketName).bucket.get(file.objectKey);
      if (file === null || object === null) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "No such file on this reconciliation.",
        });
      }
      const name = file.name.replace(/[^\w.\- ]+/g, "_");
      return new Response(object.body, {
        status: 200,
        headers: {
          "content-type": file.contentType,
          "content-disposition": `inline; filename="${name}"`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    },
  );

  app.openapi(
    { ...finishRoute, middleware: chokepointMiddleware(chokepoint, finishRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const id = c.req.valid("param").reconciliationId as TrustBankReconciliationId;
      return commitWrite(c, async (by) => ({
        write: (await composeTrustBankReconciliationFinish(firm.firmDatabase, id, by, options()))
          .effect,
        body: ok,
      }));
    },
  );
}
