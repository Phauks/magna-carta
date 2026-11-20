import { z } from "@hono/zod-openapi";
import {
  composeDepositFile,
  composeDepositFileRemoval,
  composeDepositNote,
  MAXIMUM_FEES_PER_DEPOSIT,
  MAXIMUM_LINES_PER_DEPOSIT,
  recordPaymentDeposit,
} from "@magna-carta/billing/deposit";
import {
  readOpenBillShares,
  readPaymentDeposit,
  readPaymentDepositFile,
  receiptBelongsToDeposit,
} from "@magna-carta/billing/deposit-reads";
import { PAYMENT_METHODS } from "@magna-carta/billing/payment-methods";
import { readFirmScanPolicy } from "@magna-carta/file-manager/scan-policy-settings";
import { computeVerdict, ScanFaultError } from "@magna-carta/file-manager/verdict";
import { identifierField } from "@magna-carta/identifiers/field";
import type {
  LedgerAccountId,
  PaymentDepositFileId,
  PaymentDepositId,
  PaymentReceiptId,
} from "@magna-carta/identifiers/types";
import { firmScopedObjectDimensions } from "@magna-carta/object-dimensions/dimensions";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../../chokepoint/context-accessors.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { problemJson, Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";
import { decodeBase64, sha256Hex } from "../shared/image-bytes.ts";
import {
  APPLY,
  type BillingApp,
  civilDate,
  clockOptions,
  mutationResponses,
  readErrorResponses,
  readMeta,
  runBillingEffect,
  writeMeta,
} from "./billing.ts";

// Payments the firm received by hand and deposited together. The rules are billing's (packages/
// billing/src/deposit.ts) and the commit is the shared billing effect, so a refusal here reads
// exactly as a write-off's or a credit note's does. A deposit is recorded in one request; its scans
// and files follow one request each, because each is scanned for malware before it is kept.

/** Where a deposit's files live in the firm's bucket, under the deposit's id. */
const FILE_PREFIX = "payment-deposit-file/";
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const depositParam = z.object({ depositId: identifierPathParam("paymentDeposit", "depositId") });
const fileParam = depositParam.extend({
  fileId: identifierPathParam("paymentDepositFile", "fileId"),
});

const text = (max: number) => z.string().max(max);

const DepositLine = z.object({
  invoiceId: identifierField("invoice"),
  matterId: identifierField("matter"),
  amountMinor: z.number().int().positive(),
  method: z.enum(PAYMENT_METHODS),
  reference: text(200).nullable().optional(),
  receivedFrom: text(200),
  receivedOn: civilDate,
  memo: text(200).nullable().optional(),
  details: z
    .record(z.string(), z.union([z.string(), z.record(z.string(), z.number().int()), z.null()]))
    .optional(),
  note: text(4000).nullable().optional(),
});

const RecordDepositRequest = z
  .object({
    depositToAccountId: identifierField("ledgerAccount"),
    depositedOn: civilDate,
    slipNumber: text(200).nullable().optional(),
    lines: z.array(DepositLine).min(1).max(MAXIMUM_LINES_PER_DEPOSIT),
    fees: z
      .array(z.object({ description: text(200), amountMinor: z.number().int().positive() }))
      .max(MAXIMUM_FEES_PER_DEPOSIT)
      .optional(),
    note: text(4000).nullable().optional(),
  })
  .openapi("BillingRecordDepositRequest");

const RecordDepositAck = z
  .object({ depositId: z.string(), receiptIds: z.array(z.string()) })
  .openapi("BillingRecordDepositAck");

const DepositDetail = z
  .object({
    id: z.string(),
    depositToAccountId: z.string(),
    depositToName: z.string(),
    depositedOn: z.string(),
    slipNumber: z.string().nullable(),
    currency: z.string(),
    paymentsMinor: z.number().int(),
    feesMinor: z.number().int(),
    depositMinor: z.number().int(),
    recordedBy: z.string().nullable(),
    recordedAt: z.string(),
    lines: z.array(
      z.object({
        receiptId: z.string(),
        lineNumber: z.number().int(),
        invoiceId: z.string(),
        invoiceNumber: z.string().nullable(),
        matterId: z.string(),
        matterNumber: z.string().nullable(),
        matterTitle: z.string(),
        method: z.enum(PAYMENT_METHODS),
        reference: z.string().nullable(),
        receivedFrom: z.string(),
        receivedOn: z.string(),
        amountMinor: z.number().int(),
        memo: z.string().nullable(),
        details: z.record(z.string(), z.union([z.string(), z.record(z.string(), z.number())])),
        reversed: z.boolean(),
      }),
    ),
    fees: z.array(
      z.object({
        lineNumber: z.number().int(),
        description: z.string(),
        amountMinor: z.number().int(),
      }),
    ),
    notes: z.array(
      z.object({
        id: z.string(),
        receiptId: z.string().nullable(),
        body: z.string(),
        writtenBy: z.string().nullable(),
        writtenAt: z.string(),
      }),
    ),
    files: z.array(
      z.object({
        id: z.string(),
        receiptId: z.string().nullable(),
        kind: z.enum(["scan", "file"]),
        name: z.string(),
        contentType: z.string(),
        sizeBytes: z.number().int(),
        recordedAt: z.string(),
      }),
    ),
  })
  .openapi("BillingDepositDetail");

const OpenBills = z
  .object({
    bills: z.array(
      z.object({
        invoiceId: z.string(),
        invoiceNumber: z.string().nullable(),
        issueDate: z.string().nullable(),
        matterId: z.string(),
        matterNumber: z.string().nullable(),
        matterTitle: z.string(),
        clientName: z.string().nullable(),
        currency: z.string(),
        owedMinor: z.number().int(),
      }),
    ),
  })
  .openapi("BillingOpenBills");

const DepositNoteRequest = z
  .object({ receiptId: identifierField("paymentReceipt").nullable().optional(), body: text(4000) })
  .openapi("BillingDepositNoteRequest");

const DepositFileRequest = z
  .object({
    receiptId: identifierField("paymentReceipt").nullable().optional(),
    kind: z.enum(["scan", "file"]),
    name: text(200).min(1),
    dataBase64: z.string(),
  })
  .openapi("BillingDepositFileRequest");

const Acknowledged = z.object({ id: z.string() }).openapi("BillingDepositAcknowledged");

const recordDepositRoute = defineOpenAPIRoute(writeMeta("billing.recordDeposit", APPLY), {
  method: "post",
  path: "/api/v1/billing/deposits",
  description:
    "Records payments the firm received by hand and took to the bank together on one deposit slip: checks, cash, money orders, transfers, cards run on the firm's own terminal. Each line pays one matter's share of one bill, so one deposit can pay many matters. Each line comes off what the client owes on the date it was received, into Undeposited Funds; the deposit moves the total, less any bank fees, into the operating account on the date deposited. A line cannot pay more than its bill still owes. Money to hold in trust is a trust deposit, not this.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: RecordDepositRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The deposit was recorded",
      content: { "application/json": { schema: RecordDepositAck } },
    },
    ...mutationResponses,
  },
});

const depositRoute = defineOpenAPIRoute(readMeta("billing.deposit"), {
  method: "get",
  path: "/api/v1/billing/deposits/{depositId}",
  description: "One recorded deposit: its lines, bank fees, notes and files.",
  request: { params: depositParam },
  responses: {
    200: {
      description: "The deposit",
      content: { "application/json": { schema: DepositDetail } },
    },
    ...readErrorResponses,
  },
});

const openBillsRoute = defineOpenAPIRoute(readMeta("billing.openBills"), {
  method: "get",
  path: "/api/v1/billing/open-bills",
  description:
    "Every issued bill with something still owing, one row per matter it bills: what a deposit line can pay.",
  responses: {
    200: {
      description: "The open bills",
      content: { "application/json": { schema: OpenBills } },
    },
    ...readErrorResponses,
  },
});

const depositNoteRoute = defineOpenAPIRoute(writeMeta("billing.addDepositNote", APPLY), {
  method: "post",
  path: "/api/v1/billing/deposits/{depositId}/notes",
  description: "Adds a note to a deposit or one of its lines. Notes are never edited or removed.",
  request: {
    headers: idempotencyKeyHeader,
    params: depositParam,
    body: { content: { "application/json": { schema: DepositNoteRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The note was kept",
      content: { "application/json": { schema: Acknowledged } },
    },
    ...mutationResponses,
  },
});

const depositFileRoute = defineOpenAPIRoute(writeMeta("billing.attachDepositFile", APPLY), {
  method: "post",
  path: "/api/v1/billing/deposits/{depositId}/files",
  description:
    "Keeps a file with a deposit or one of its lines: a check scan, the deposit slip, a wire confirmation. PDF, PNG or JPEG, up to 25 MB. The file is malware-scanned first and not kept when the scan flags it.",
  request: {
    headers: idempotencyKeyHeader,
    params: depositParam,
    body: { content: { "application/json": { schema: DepositFileRequest } }, required: true },
  },
  responses: {
    201: {
      description: "The file was kept",
      content: { "application/json": { schema: Acknowledged } },
    },
    ...mutationResponses,
    503: {
      description: "The malware-scan engine did not answer; nothing was kept",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const depositFileRemovalRoute = defineOpenAPIRoute(
  writeMeta("billing.removeDepositFile", APPLY),
  {
    method: "post",
    path: "/api/v1/billing/deposits/{depositId}/files/{fileId}/removal",
    description: "Takes a file off a deposit. The bytes are kept, as payment records are.",
    request: { headers: idempotencyKeyHeader, params: fileParam },
    responses: {
      201: {
        description: "The file was taken off",
        content: { "application/json": { schema: Acknowledged } },
      },
      ...mutationResponses,
    },
  },
);

const depositFileReadRoute = defineOpenAPIRoute(readMeta("billing.depositFile"), {
  method: "get",
  path: "/api/v1/billing/deposits/{depositId}/files/{fileId}",
  description: "A file kept with a deposit, as it was attached.",
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
    ...readErrorResponses,
  },
});

// What the bytes are, read from their first bytes rather than from the name or the browser's word.
function sniffFile(bytes: Uint8Array): { contentType: string } | null {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return { contentType: "application/pdf" };
  if (starts(0x89, 0x50, 0x4e, 0x47)) return { contentType: "image/png" };
  if (starts(0xff, 0xd8, 0xff)) return { contentType: "image/jpeg" };
  return null;
}

const notFound = (detail: string) => ({
  type: "not-found" as const,
  title: "Not found",
  status: 404 as const,
  detail,
});

export function registerPaymentRoutes(app: BillingApp, chokepoint: Chokepoint): void {
  app.openapi(
    { ...openBillsRoute, middleware: chokepointMiddleware(chokepoint, openBillsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      return c.json({ bills: [...(await readOpenBillShares(firm.firmDatabase))] }, 200);
    },
  );

  app.openapi(
    { ...recordDepositRoute, middleware: chokepointMiddleware(chokepoint, recordDepositRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = c.req.valid("json");
      const outcome = await runBillingEffect<z.infer<typeof RecordDepositAck>>(
        c,
        201,
        async (recordedBy) => {
          const composed = await recordPaymentDeposit(
            firm.firmDatabase,
            {
              depositToAccountId: request.depositToAccountId as LedgerAccountId,
              depositedOn: request.depositedOn,
              slipNumber: request.slipNumber ?? null,
              lines: request.lines.map((line) => ({
                ...line,
                reference: line.reference ?? null,
                memo: line.memo ?? null,
                note: line.note ?? null,
                details: line.details ?? {},
              })),
              fees: request.fees ?? [],
              note: request.note ?? null,
              recordedBy,
            },
            clockOptions(),
          );
          return {
            write: composed.effect,
            body: { depositId: composed.depositId, receiptIds: [...composed.receiptIds] },
          };
        },
      );
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 201);
    },
  );

  app.openapi(
    { ...depositRoute, middleware: chokepointMiddleware(chokepoint, depositRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { depositId } = c.req.valid("param");
      const deposit = await readPaymentDeposit(firm.firmDatabase, depositId as PaymentDepositId);
      if (!deposit) return problemJson(c, notFound("No such deposit."));
      return c.json(
        {
          ...deposit,
          lines: deposit.lines.map((line) => ({ ...line, details: { ...line.details } })),
          fees: [...deposit.fees],
          notes: [...deposit.notes],
          files: [...deposit.files],
        },
        200,
      );
    },
  );

  app.openapi(
    { ...depositNoteRoute, middleware: chokepointMiddleware(chokepoint, depositNoteRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const depositId = c.req.valid("param").depositId as PaymentDepositId;
      const request = c.req.valid("json");
      const receiptId = (request.receiptId ?? null) as PaymentReceiptId | null;
      if (!(await readPaymentDeposit(firm.firmDatabase, depositId))) {
        return problemJson(c, notFound("No such deposit."));
      }
      if (receiptId && !(await receiptBelongsToDeposit(firm.firmDatabase, depositId, receiptId))) {
        return problemJson(c, notFound("No such line on this deposit."));
      }
      const outcome = await runBillingEffect<{ id: string }>(c, 201, async (writtenBy) => {
        const composed = composeDepositNote(
          firm.firmDatabase,
          { depositId, receiptId, body: request.body, writtenBy },
          clockOptions(),
        );
        return { write: composed.effect, body: { id: composed.noteId } };
      });
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 201);
    },
  );

  app.openapi(
    { ...depositFileRoute, middleware: chokepointMiddleware(chokepoint, depositFileRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const depositId = c.req.valid("param").depositId as PaymentDepositId;
      const request = c.req.valid("json");
      const receiptId = (request.receiptId ?? null) as PaymentReceiptId | null;
      if (!(await readPaymentDeposit(firm.firmDatabase, depositId))) {
        return problemJson(c, notFound("No such deposit."));
      }
      if (receiptId && !(await receiptBelongsToDeposit(firm.firmDatabase, depositId, receiptId))) {
        return problemJson(c, notFound("No such line on this deposit."));
      }
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
      if (bytes.byteLength > MAX_FILE_BYTES) {
        return problemJson(c, {
          type: "validation",
          title: "File too large",
          status: 422,
          detail: "Attach a file of 25 MB or less.",
        });
      }
      // A check scan or a slip is a file from outside the firm, so it is scanned like any upload,
      // with the same engine, the firm's own scan policy and the same verdict. A flagged file is
      // refused and never kept; an engine that does not answer is a 503 the member can retry.
      const { resolveScanPort } = await import("../../../files/scan-port-binding.ts");
      let verdict: ReturnType<typeof computeVerdict>;
      try {
        const raw = await resolveScanPort(c.env).scan(
          new Response(bytes as unknown as BodyInit).body!,
          { sizeBytes: bytes.byteLength, sniffedContentType: sniffed.contentType },
        );
        verdict = computeVerdict(raw, await readFirmScanPolicy(firm.firmDatabase));
      } catch (error) {
        if (!(error instanceof ScanFaultError)) throw error;
        return problemJson(c, {
          type: "service-unavailable",
          title: "The scan engine is unreachable",
          status: 503,
          detail: "The malware scan did not answer, so the file was not kept. Try again shortly.",
        });
      }
      if (verdict.verdict === "flagged") {
        return problemJson(c, {
          type: "validation",
          title: "This file failed the malware scan",
          status: 422,
          detail: "The file was not kept.",
        });
      }
      // The bytes go to the bucket BEFORE the row that names them, so a row never points at
      // nothing. The key is the content's hash, so a retry writes the same object.
      const digest = await sha256Hex(bytes);
      const objectKey = `${FILE_PREFIX}${depositId}/${digest}`;
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
      await bucket.put(objectKey, bytes, {
        sha256: digest,
        httpMetadata: { contentType: sniffed.contentType },
        customMetadata: firmScopedObjectDimensions("payment-deposit-file"),
      });
      const outcome = await runBillingEffect<{ id: string }>(c, 201, async (recordedBy) => {
        const composed = composeDepositFile(
          firm.firmDatabase,
          {
            depositId,
            receiptId,
            kind: request.kind,
            name: request.name,
            contentType: sniffed.contentType,
            sizeBytes: bytes.byteLength,
            objectKey,
            sha256: digest,
            recordedBy,
          },
          clockOptions(),
        );
        return { write: composed.effect, body: { id: composed.fileId } };
      });
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 201);
    },
  );

  app.openapi(
    {
      ...depositFileRemovalRoute,
      middleware: chokepointMiddleware(chokepoint, depositFileRemovalRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const params = c.req.valid("param");
      const outcome = await runBillingEffect<{ id: string }>(c, 201, async (removedBy) => ({
        write: await composeDepositFileRemoval(
          firm.firmDatabase,
          params.depositId as PaymentDepositId,
          params.fileId as PaymentDepositFileId,
          removedBy,
          clockOptions(),
        ),
        body: { id: params.fileId },
      }));
      if (outcome.kind === "refused") return outcome.response;
      return c.json(outcome.body, 201);
    },
  );

  app.openapi(
    { ...depositFileReadRoute, middleware: chokepointMiddleware(chokepoint, depositFileReadRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const params = c.req.valid("param");
      const file = await readPaymentDepositFile(
        firm.firmDatabase,
        params.depositId as PaymentDepositId,
        params.fileId as PaymentDepositFileId,
      );
      const object =
        file === undefined
          ? null
          : await resolveFirmBucket(c.env, firm.bucketName).bucket.get(file.objectKey);
      if (file === undefined || object === null) {
        return problemJson(c, notFound("No such file on this deposit."));
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
}
