import { z } from "@hono/zod-openapi";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { TransferRunId, TransferSourceFileId } from "@magna-carta/identifiers/types";
import { firmScopedObjectDimensions } from "@magna-carta/object-dimensions/dimensions";
import {
  CompleteTransferFileUploadRequest,
  SOURCE_FILE_IN_PARTS_BYTE_CAP,
  SOURCE_FILE_PART_BYTES,
  StartTransferFileUploadResponse,
  TransferFileUploadPartResponse,
  TransferSourceFileResponse,
} from "@magna-carta/record-transfer/contract";
import { transferSourceFileObjectKey } from "@magna-carta/record-transfer/source-file";
import {
  registerTransferSourceFileEffect,
  transferFileUploadStepEffect,
} from "@magna-carta/record-transfer/transfer-requests";
import {
  selectTransferSourceFileStatement,
  selectTransferSourceFilesStatement,
  type TransferSourceFileRow,
} from "@magna-carta/record-transfer/transfer-source-file-statements";
import { transferSourceFileBody } from "@magna-carta/record-transfer/transfer-views";
import type { Context } from "hono";
import { createWorkerDigestSink } from "../../../file-integrity/worker-sink.ts";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";
import type { AppRouter } from "../domain-app.ts";
import {
  errors,
  notFound,
  readRun,
  runEnded,
  runIsOpen,
  runParam,
  writeMeta,
} from "./shared.ts";

// A source file given in pieces: a whole table of a database is larger than one request may carry.
//
// THE PIECES GO STRAIGHT TO THE FIRM'S BUCKET, under the key the finished file will have. Starting
// mints the file's identifier and opens the upload; each piece is one request of at most
// SOURCE_FILE_PART_BYTES; completing joins them, reads the joined object once to take its digest,
// and only then writes the row. So the rule of the single-request upload holds here too: a row
// never names an object that is not there, and an upload that is walked away from leaves no file
// in the run. The bucket's own rule reclaims the pieces of an upload nobody completed.
//
// NOTHING IS REMEMBERED BETWEEN REQUESTS. The caller sends back the upload's identifier with each
// piece and with the completion. It can only ever name an upload under this run's own prefix in
// this firm's bucket, because the key is built here from the run and the file.
//
// THE SAME BYTES ARE NOT TAKEN TWICE INTO ONE RUN, exactly as for a small file: the digest decides,
// the joined object is taken back, and the answer is 409.

const uploadParam = z.object({
  runId: runParam.shape.runId,
  fileId: z
    .string()
    .regex(/^transferSourceFile_[A-Za-z0-9_-]{1,64}$/)
    .openapi({ param: { name: "fileId", in: "path" } }),
});

const partParam = uploadParam.extend({
  partNumber: z.coerce
    .number()
    .int()
    .min(1)
    .max(1000)
    .openapi({ param: { name: "partNumber", in: "path" } }),
});

const partQuery = z.object({ uploadId: z.string().min(1).max(1024) });

const meta = (operationId: string) => ({ ...writeMeta(operationId), idempotency: "optional" as const });

const startRoute = defineOpenAPIRoute(meta("recordTransfer.startSourceFileUpload"), {
  method: "post",
  path: "/api/v1/record-transfer/runs/{runId}/file-uploads",
  description:
    "Starts giving a run a source file in pieces, for a file too large for one request. Answers the file's identifier, the upload's identifier and the size every piece but the last must be. No file is in the run until the upload is completed.",
  request: { params: runParam },
  responses: {
    201: {
      description: "The upload that was opened",
      content: { "application/json": { schema: StartTransferFileUploadResponse } },
    },
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    429: errors[429],
  },
});

const partRoute = defineOpenAPIRoute(meta("recordTransfer.addSourceFileUploadPart"), {
  method: "put",
  path: "/api/v1/record-transfer/runs/{runId}/file-uploads/{fileId}/parts/{partNumber}",
  description:
    "Gives one piece of a source file. The body is the piece's bytes. Pieces are numbered from 1, may be sent in any order and sent again; the answer's etag is sent back when the upload is completed.",
  request: {
    params: partParam,
    query: partQuery,
    body: { required: true, content: { "application/octet-stream": { schema: z.any() } } },
  },
  responses: {
    200: {
      description: "The piece as stored",
      content: { "application/json": { schema: TransferFileUploadPartResponse } },
    },
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    413: errors[413],
    422: errors[422],
    429: errors[429],
  },
});

const completeRoute = defineOpenAPIRoute(meta("recordTransfer.completeSourceFileUpload"), {
  method: "post",
  path: "/api/v1/record-transfer/runs/{runId}/file-uploads/{fileId}/complete",
  description:
    "Joins the pieces of a source file and gives the file to the run. The same bytes given to one run a second time are refused, and nothing is kept.",
  request: {
    params: uploadParam,
    body: {
      required: true,
      content: { "application/json": { schema: CompleteTransferFileUploadRequest } },
    },
  },
  responses: {
    201: {
      description: "The file as the run now holds it",
      content: { "application/json": { schema: TransferSourceFileResponse } },
    },
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    413: errors[413],
    422: errors[422],
    429: errors[429],
  },
});

function uploadNotOpen(c: Context) {
  return problemJson(c, {
    type: "conflict",
    title: "The upload is not open",
    status: 409,
    detail:
      "This upload was completed, was left too long, or its pieces do not match. Start the upload again.",
  });
}

function tooLarge(c: Context, limit: number) {
  return problemJson(c, {
    type: "upload-not-allowed",
    title: "File too large",
    status: 413,
    detail: `At most ${limit} bytes are taken here.`,
  });
}

// The digest of a stored object, read once from the bucket and never held whole.
async function storedSha256(bucket: R2Bucket, objectKey: string): Promise<string | null> {
  const object = await bucket.get(objectKey);
  if (object === null) return null;
  const sink = createWorkerDigestSink("SHA-256");
  const reader = object.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    await sink.write(value);
  }
  return sink.close();
}

export function registerTransferFileUploadRoutes(app: AppRouter, chokepoint: Chokepoint): void {
  app.openapi(
    { ...startRoute, middleware: chokepointMiddleware(chokepoint, startRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { runId } = c.req.valid("param");
      const run = await readRun(firm.firmDatabase, runId);
      if (run === null) return notFound(c, "run");
      if (!runIsOpen(run)) return runEnded(c);
      const fileId = newIdentifier("transferSourceFile") as TransferSourceFileId;
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
      const upload = await bucket.createMultipartUpload(
        transferSourceFileObjectKey(run.id, fileId),
        { customMetadata: firmScopedObjectDimensions("transfer-source-file") },
      );
      const now = new Date().toISOString();
      await commitEffectBatch(
        firm.firmDatabase,
        transferFileUploadStepEffect(
          firm.firmDatabase,
          { fileId, transferRunId: run.id },
          { actorUserId: userId, now },
        ),
        { now: () => now },
      );
      return c.json(
        { fileId, uploadId: upload.uploadId, partBytes: SOURCE_FILE_PART_BYTES },
        201,
      );
    },
  );

  app.openapi(
    { ...partRoute, middleware: chokepointMiddleware(chokepoint, partRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { runId, fileId, partNumber } = c.req.valid("param");
      const { uploadId } = c.req.valid("query");
      const run = await readRun(firm.firmDatabase, runId);
      if (run === null) return notFound(c, "run");
      if (!runIsOpen(run)) return runEnded(c);
      if (Number(c.req.header("content-length") ?? "0") > SOURCE_FILE_PART_BYTES) {
        await c.req.raw.body?.cancel();
        return tooLarge(c, SOURCE_FILE_PART_BYTES);
      }
      // One piece is held while it is handed on, because the bucket takes a piece of a known
      // length. A piece is capped at what the single-request upload already holds.
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      if (bytes.byteLength > SOURCE_FILE_PART_BYTES) return tooLarge(c, SOURCE_FILE_PART_BYTES);
      if (bytes.byteLength === 0) {
        return problemJson(c, {
          type: "validation",
          title: "Empty body",
          status: 400,
          detail: "Provide the piece's bytes as the request body.",
        });
      }
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
      const upload = bucket.resumeMultipartUpload(
        transferSourceFileObjectKey(run.id, fileId as TransferSourceFileId),
        uploadId,
      );
      let etag: string;
      try {
        etag = (await upload.uploadPart(partNumber, bytes)).etag;
      } catch {
        // The bucket knows no such open upload under this run's key.
        return uploadNotOpen(c);
      }
      const now = new Date().toISOString();
      await commitEffectBatch(
        firm.firmDatabase,
        transferFileUploadStepEffect(
          firm.firmDatabase,
          { fileId: fileId as TransferSourceFileId, transferRunId: run.id, partNumber },
          { actorUserId: userId, now },
        ),
        { now: () => now },
      );
      return c.json({ part: { partNumber, etag } }, 200);
    },
  );

  app.openapi(
    { ...completeRoute, middleware: chokepointMiddleware(chokepoint, completeRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { runId, fileId } = c.req.valid("param");
      const body = c.req.valid("json");
      const run = await readRun(firm.firmDatabase, runId);
      if (run === null) return notFound(c, "run");
      if (!runIsOpen(run)) return runEnded(c);
      const id = fileId as TransferSourceFileId;
      const already = await selectTransferSourceFileStatement(
        firm.firmDatabase,
        id,
      ).first<TransferSourceFileRow>();
      // A completion delivered twice is answered with the file the first one made.
      if (already !== null) {
        return already.transfer_run_id === run.id
          ? c.json({ file: transferSourceFileBody(already) }, 201)
          : notFound(c, "file");
      }
      const objectKey = transferSourceFileObjectKey(run.id as TransferRunId, id);
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
      let joined: R2Object;
      try {
        joined = await bucket
          .resumeMultipartUpload(objectKey, body.uploadId)
          .complete(
            body.parts
              .toSorted((left, right) => left.partNumber - right.partNumber)
              .map((part) => ({ partNumber: part.partNumber, etag: part.etag })),
          );
      } catch {
        return uploadNotOpen(c);
      }
      const takeBack = () => bucket.delete(objectKey).catch(() => undefined);
      if (joined.size > SOURCE_FILE_IN_PARTS_BYTE_CAP) {
        await takeBack();
        return tooLarge(c, SOURCE_FILE_IN_PARTS_BYTE_CAP);
      }
      const contentSha256 = await storedSha256(bucket, objectKey);
      if (contentSha256 === null) return uploadNotOpen(c);
      const alreadyHeld = () =>
        problemJson(c, {
          type: "conflict",
          title: "The file is already in this run",
          status: 409,
          detail: "This run already holds a file with exactly these bytes.",
        });
      const held = await selectTransferSourceFilesStatement(
        firm.firmDatabase,
        run.id,
      ).all<TransferSourceFileRow>();
      if (held.results.some((file) => file.content_sha256 === contentSha256)) {
        await takeBack();
        return alreadyHeld();
      }
      const now = new Date().toISOString();
      try {
        await commitEffectBatch(
          firm.firmDatabase,
          registerTransferSourceFileEffect(
            firm.firmDatabase,
            {
              id,
              transferRunId: run.id,
              sourceKind: body.sourceKind,
              format: "delimited-text",
              fileName: body.fileName,
              byteLength: joined.size,
              contentSha256,
              keyColumn: null,
            },
            { actorUserId: userId, now },
          ),
          { now: () => now },
        );
      } catch (caught) {
        await takeBack();
        if (caught instanceof Error && caught.message.includes("UNIQUE constraint failed")) {
          return alreadyHeld();
        }
        throw caught;
      }
      const row = await selectTransferSourceFileStatement(
        firm.firmDatabase,
        id,
      ).first<TransferSourceFileRow>();
      if (row === null) throw new Error("a registered source file could not be read back");
      return c.json({ file: transferSourceFileBody(row) }, 201);
    },
  );
}
