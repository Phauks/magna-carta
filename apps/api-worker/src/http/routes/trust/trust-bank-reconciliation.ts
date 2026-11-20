import { type OpenAPIHono } from "@hono/zod-openapi";
import type {
  TrustAccountId,
  TrustBankReconciliationChangeId,
  TrustBankReconciliationFileId,
  TrustBankReconciliationId,
  TrustBankReconciliationInterestId,
  TrustBankReconciliationRestorePointId,
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
  readNextBankReconciliationStart,
  readTrustBankReconciliation,
  readTrustBankReconciliationFile,
  readTrustBankReconciliations,
  type BankReconciliationEdit,
} from "@magna-carta/trust/bank-reconciliation";
import { MAX_BANK_RECONCILIATION_FILE_BYTES } from "@magna-carta/trust/bank-reconciliation-contract";
import { TrustValidationError } from "@magna-carta/trust/trust-validation";
import type { Bindings } from "../../../bindings.ts";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { problemJson } from "../../contracts/problem.ts";
import { decodeBase64, sha256Hex } from "../shared/image-bytes.ts";

// BANK RECONCILIATION: the list of periods on an account, one period with its book items, and every
// change a person makes to it. The rules are @magna-carta/trust's (src/bank-reconciliation.ts) and
// the migration's triggers; this module composes, commits and answers. A write answers with a short
// acknowledgement and the screen reads the period again, which is also how it sees other people's
// changes while they work.

import {
  FILE_PREFIX,
  options,
  json,
  body,
  listRoute,
  startRoute,
  getRoute,
  editsRoute,
  revertRoute,
  saveRoute,
  restoreRoute,
  interestRoute,
  interestRemovalRoute,
  noteRoute,
  fileRoute,
  fileRemovalRoute,
  fileReadRoute,
  finishRoute,
} from "./trust-bank-reconciliation-routes.ts";

import {
  lineKey,
  detailRecord,
  summaryRecord,
  refusal,
  commitWrite,
  sniffFile,
  ok,
} from "./trust-bank-reconciliation-records.ts";

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
