import { z } from "@hono/zod-openapi";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { firmScopedObjectDimensions } from "@magna-carta/object-dimensions/dimensions";
import type { TransferSourceFileId } from "@magna-carta/identifiers/types";
import {
  TransferSourceFilePreviewResponse,
  TransferSourceFileResponse,
} from "@magna-carta/record-transfer/contract";
import {
  DelimitedTextError,
  readDelimitedText,
} from "@magna-carta/record-transfer/delimited-text-reader";
import { transferSourceFileObjectKey } from "@magna-carta/record-transfer/source-file";
import { registerTransferSourceFileEffect } from "@magna-carta/record-transfer/transfer-requests";
import {
  selectTransferSourceFileStatement,
  selectTransferSourceFilesStatement,
  type TransferSourceFileRow,
} from "@magna-carta/record-transfer/transfer-source-file-statements";
import { transferSourceFileBody } from "@magna-carta/record-transfer/transfer-views";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
import { sourceFileText } from "../../../record-transfer/source-file-text.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";
import type { AppRouter } from "../domain-app.ts";
import { sha256Hex } from "../shared/image-bytes.ts";
import {
  errors,
  fileParam,
  notFound,
  readMeta,
  readRun,
  runEnded,
  runIsOpen,
  runParam,
  writeMeta,
} from "./shared.ts";

// A run's source files: giving one, and reading its first rows.
//
// THE FILE IS KEPT AS IT ARRIVED. The bytes go to the firm's bucket under a key built from the run
// and the file's own identifier, and the row that points at them is written second, so a row never
// names an object that is not there. Nothing in the file is copied into the database: an extract
// carries bank and identity numbers in columns nobody can name in advance.
//
// THE SAME BYTES ARE NOT TAKEN TWICE INTO ONE RUN. The file's digest is what says so, which is why
// this write asks for no Idempotency-Key: a press delivered twice is answered 409 the second time,
// with nothing stored.
//
// A FILE'S NAME IS A PERSON'S WORD FOR IT. It is shown back on the run and is no part of where the
// bytes are kept.

// The largest source file taken in one request. The whole body is held while its digest is
// computed, so the cap is what a request can hold with room to spare. A list of every matter a
// mid-sized firm has opened is a few megabytes.
export const SOURCE_FILE_BYTE_CAP = 32 * 1024 * 1024;

const PREVIEW_ROWS = 3;

const uploadQuery = z.object({
  fileName: z.string().trim().min(1).max(255),
  // What the file is a list of, as a slug the operator chooses: `card-list`, `matter-list`.
  sourceKind: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/),
});

const previewQuery = z.object({
  delimiter: z.enum(["comma", "tab", "semicolon", "pipe"]).optional(),
});

const DELIMITERS = { comma: ",", tab: "\t", semicolon: ";", pipe: "|" } as const;

const uploadRoute = defineOpenAPIRoute(
  { ...writeMeta("recordTransfer.addSourceFile"), idempotency: "optional" },
  {
    method: "post",
    path: "/api/v1/record-transfer/runs/{runId}/files",
    description:
      "Gives a source file to a run. The body is the file's bytes, kept unchanged; the file's rows are read when a pass is asked for. The same bytes given to one run a second time are refused.",
    request: {
      params: runParam,
      query: uploadQuery,
      body: { required: true, content: { "application/octet-stream": { schema: z.any() } } },
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
  },
);

const previewRoute = defineOpenAPIRoute(readMeta("recordTransfer.previewSourceFile"), {
  method: "get",
  path: "/api/v1/record-transfer/runs/{runId}/files/{fileId}/preview",
  description:
    "The file's header row and its first three data rows, read from the stored file when asked, so a person can say what each column holds. These are values from the file; they are answered to the member and stored nowhere.",
  request: { params: fileParam, query: previewQuery },
  responses: {
    200: {
      description: "The column names and the first rows",
      content: { "application/json": { schema: TransferSourceFilePreviewResponse } },
    },
    401: errors[401],
    403: errors[403],
    404: errors[404],
    422: errors[422],
    429: errors[429],
  },
});

function tooLarge(c: Parameters<typeof problemJson>[0]) {
  return problemJson(c, {
    type: "upload-not-allowed",
    title: "File too large",
    status: 413,
    detail: `A source file may be at most ${SOURCE_FILE_BYTE_CAP} bytes.`,
  });
}

export function registerTransferSourceFileRoutes(app: AppRouter, chokepoint: Chokepoint): void {
  app.openapi(
    { ...uploadRoute, middleware: chokepointMiddleware(chokepoint, uploadRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { runId } = c.req.valid("param");
      const { fileName, sourceKind } = c.req.valid("query");
      const run = await readRun(firm.firmDatabase, runId);
      if (run === null) return notFound(c, "run");
      if (!runIsOpen(run)) return runEnded(c);
      if (Number(c.req.header("content-length") ?? "0") > SOURCE_FILE_BYTE_CAP) {
        await c.req.raw.body?.cancel();
        return tooLarge(c);
      }
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      if (bytes.byteLength > SOURCE_FILE_BYTE_CAP) return tooLarge(c);
      if (bytes.byteLength === 0) {
        return problemJson(c, {
          type: "validation",
          title: "Empty body",
          status: 400,
          detail: "Provide the file's bytes as the request body.",
        });
      }
      const contentSha256 = await sha256Hex(bytes);
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
      if (held.results.some((file) => file.content_sha256 === contentSha256)) return alreadyHeld();

      const id = newIdentifier("transferSourceFile") as TransferSourceFileId;
      const objectKey = transferSourceFileObjectKey(run.id, id);
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
      const now = new Date().toISOString();
      await bucket.put(objectKey, bytes, {
        sha256: contentSha256,
        customMetadata: firmScopedObjectDimensions("transfer-source-file"),
      });
      try {
        await commitEffectBatch(
          firm.firmDatabase,
          registerTransferSourceFileEffect(
            firm.firmDatabase,
            {
              id,
              transferRunId: run.id,
              sourceKind,
              format: "delimited-text",
              fileName,
              byteLength: bytes.byteLength,
              contentSha256,
              keyColumn: null,
            },
            { actorUserId: userId, now },
          ),
          { now: () => now },
        );
      } catch (caught) {
        // No row names the object, so it is taken back before the refusal is answered.
        await bucket.delete(objectKey).catch(() => undefined);
        // Two deliveries of the same file raced past the read above; the unique index on the run
        // and the digest let one through.
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

  app.openapi(
    { ...previewRoute, middleware: chokepointMiddleware(chokepoint, previewRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { runId, fileId } = c.req.valid("param");
      const { delimiter } = c.req.valid("query");
      const file = await selectTransferSourceFileStatement(
        firm.firmDatabase,
        fileId as TransferSourceFileId,
      ).first<TransferSourceFileRow>();
      if (file === null || file.transfer_run_id !== runId || file.removed_at !== null) {
        return notFound(c, "file");
      }
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
      const text = await sourceFileText(bucket, file.object_key);
      if (text === null) return notFound(c, "file");
      let columns: readonly string[] = [];
      const rows: string[][] = [];
      try {
        for await (const event of readDelimitedText(text, {
          delimiter: DELIMITERS[delimiter ?? "comma"],
        })) {
          if (event.kind === "header") columns = event.columns;
          else rows.push([...event.row.values]);
          if (rows.length === PREVIEW_ROWS) break;
        }
      } catch (caught) {
        if (!(caught instanceof DelimitedTextError)) throw caught;
        // The reader's sentence is fixed wording and holds nothing from the file.
        return problemJson(c, {
          type: "validation",
          title: "The file cannot be read as rows",
          status: 422,
          detail: caught.message,
        });
      }
      return c.json({ columns: [...columns], rows }, 200);
    },
  );
}
