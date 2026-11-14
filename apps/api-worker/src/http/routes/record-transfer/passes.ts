import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { isResolvableTimeZone } from "@magna-carta/civil-time/time-zone";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { TransferPassId, TransferSourceFileId } from "@magna-carta/identifiers/types";
import {
  RequestTransferPassRequest,
  TransferPassReportResponse,
  TransferPassResponse,
  type TransferPassBody,
  type TransferPassReportResponseBody,
} from "@magna-carta/record-transfer/contract";
import type { MatterMappingRules } from "@magna-carta/record-transfer/matter-mapping";
import { statedTransferPassJson } from "@magna-carta/record-transfer/requested-pass";
import {
  selectTransferPassStatement,
  type TransferPassRow,
} from "@magna-carta/record-transfer/transfer-pass-statements";
import {
  requestTransferPassEffect,
  unknownMatterRuleReferences,
} from "@magna-carta/record-transfer/transfer-requests";
import {
  selectTransferSourceFileStatement,
  type TransferSourceFileRow,
} from "@magna-carta/record-transfer/transfer-source-file-statements";
import { transferPassBody } from "@magna-carta/record-transfer/transfer-views";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader } from "../../contracts/common.ts";
import { problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
import type { AppRouter } from "../domain-app.ts";
import {
  errors,
  notFound,
  passParam,
  readMeta,
  readRun,
  runEnded,
  runIsOpen,
  runParam,
  writeMeta,
} from "./shared.ts";

// A pass over one of a run's files: asking for one, reading how it stands, and reading its report.
//
// A PASS IS ASKED FOR HERE AND RUN ELSEWHERE. It is work in proportion to the file, so the write
// records the request with the rules as they were stated and puts a message on the firm's outbox
// in the same batch; the per-firm queue's consumer reads the file and loads its rows
// (src/background/record-transfer/pass-consumer.ts). The answer is 202 and the pass's own read
// says when it has ended.
//
// A PASS CAN BE ASKED FOR AGAIN AT ANY TIME, over the same file or with different rules. A row
// whose record already arrived is counted and left as it is, so a second pass finishes what the
// first could not and repeats nothing.

const requestRoute = defineOpenAPIRoute(writeMeta("recordTransfer.requestPass"), {
  method: "post",
  path: "/api/v1/record-transfer/runs/{runId}/passes",
  description:
    "Asks for a pass over one of the run's files: which kind of record its rows are, which column holds each row's key, and the mapping rules that say what each column holds. The request is recorded and answered at once; the pass runs afterwards.",
  request: {
    headers: idempotencyKeyHeader,
    params: runParam,
    body: {
      required: true,
      content: { "application/json": { schema: RequestTransferPassRequest } },
    },
  },
  responses: {
    202: {
      description: "The pass was asked for and is queued",
      content: { "application/json": { schema: TransferPassResponse } },
    },
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

const getRoute = defineOpenAPIRoute(readMeta("recordTransfer.getPass"), {
  method: "get",
  path: "/api/v1/record-transfer/runs/{runId}/passes/{passId}",
  description:
    "How one pass stands: asked for, running, stalled, finished or failed, with its counts once it has finished.",
  request: { params: passParam },
  responses: {
    200: {
      description: "The pass",
      content: { "application/json": { schema: TransferPassResponse } },
    },
    401: errors[401],
    403: errors[403],
    404: errors[404],
    429: errors[429],
  },
});

const reportRoute = defineOpenAPIRoute(readMeta("recordTransfer.getPassReport"), {
  method: "get",
  path: "/api/v1/record-transfer/runs/{runId}/passes/{passId}/report",
  description:
    "The whole report of a pass that has ended: every rejected row with its reason, every row waiting for a record it names, every value left out, and a sample of the records created. It holds positions, column names, fixed reasons, source keys and identifiers, and no other value from the file. A pass that failed answers why instead. Both are null while the pass has not ended.",
  request: { params: passParam },
  responses: {
    200: {
      description: "The report, or the reason there is none",
      content: { "application/json": { schema: TransferPassReportResponse } },
    },
    401: errors[401],
    403: errors[403],
    404: errors[404],
    429: errors[429],
  },
});

const NOTHING_YET: TransferPassReportResponseBody = { report: null, failure: null };

export function registerTransferPassRoutes(app: AppRouter, chokepoint: Chokepoint): void {
  app.openapi(
    { ...requestRoute, middleware: chokepointMiddleware(chokepoint, requestRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { runId } = c.req.valid("param");
      const body = c.req.valid("json");
      const run = await readRun(firm.firmDatabase, runId);
      if (run === null) return notFound(c, "run");
      if (!runIsOpen(run)) return runEnded(c);
      const file = await selectTransferSourceFileStatement(
        firm.firmDatabase,
        body.fileId as TransferSourceFileId,
      ).first<TransferSourceFileRow>();
      if (file === null || file.transfer_run_id !== run.id || file.removed_at !== null) {
        return notFound(c, "file");
      }
      if (body.recordKind === "matter") {
        const refusal = await matterRulesRefusal(firm.firmDatabase, body.rules);
        if (refusal !== null) {
          return problemJson(c, {
            type: "validation",
            title: "The mapping rules name something this firm does not have",
            status: 422,
            detail: refusal,
          });
        }
      }

      const now = new Date().toISOString();
      const id = newIdentifier("transferPass") as TransferPassId;
      const answer: TransferPassBody = {
        id,
        fileId: file.id,
        recordKind: body.recordKind,
        sourceKind: body.sourceKind,
        state: "requested",
        requestedBy: userId,
        requestedAt: now,
        startedAt: null,
        finishedAt: null,
        failedAt: null,
        counts: null,
      };
      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now: () => now,
        effect: async () => ({
          write: requestTransferPassEffect(
            firm.firmDatabase,
            {
              id,
              transferRunId: run.id,
              transferSourceFileId: file.id,
              recordKind: body.recordKind,
              sourceKind: body.sourceKind,
              rulesJson: statedTransferPassJson({
                keyColumn: body.keyColumn,
                ...(body.delimiter === undefined ? {} : { delimiter: body.delimiter }),
                rules: body.rules,
              }),
            },
            { actorUserId: userId, now },
          ),
          responseCode: 202,
          responseBody: canonicalJsonStringify(answer),
        }),
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      const recorded =
        result.responseBody === null
          ? answer
          : (JSON.parse(result.responseBody) as TransferPassBody);
      return c.json({ pass: recorded }, 202);
    },
  );

  app.openapi(
    { ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { runId, passId } = c.req.valid("param");
      const pass = await readPass(firm.firmDatabase, runId, passId);
      if (pass === null) return notFound(c, "pass");
      return c.json({ pass: transferPassBody(pass, new Date().toISOString()) }, 200);
    },
  );

  app.openapi(
    { ...reportRoute, middleware: chokepointMiddleware(chokepoint, reportRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { runId, passId } = c.req.valid("param");
      const pass = await readPass(firm.firmDatabase, runId, passId);
      if (pass === null) return notFound(c, "pass");
      if (pass.finished_at === null && pass.failed_at === null) return c.json(NOTHING_YET, 200);
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
      const object = await bucket.get(pass.report_object_key);
      if (object === null) return c.json(NOTHING_YET, 200);
      // Written by the pass itself in the declared shape, so it is answered as stored.
      return c.json(await object.json<TransferPassReportResponseBody>(), 200);
    },
  );
}

type FirmDatabase = Parameters<typeof readRun>[0];

async function readPass(
  database: FirmDatabase,
  runId: string,
  passId: string,
): Promise<TransferPassRow | null> {
  const pass = await selectTransferPassStatement(
    database,
    passId as TransferPassId,
  ).first<TransferPassRow>();
  return pass === null || pass.transfer_run_id !== runId ? null : pass;
}

// Why a matter's rules cannot be run as stated, or null when they can. The identifiers named are
// the request's own, never a value from a file.
async function matterRulesRefusal(
  database: FirmDatabase,
  rules: Extract<
    import("@magna-carta/record-transfer/contract").RequestTransferPassBody,
    { recordKind: "matter" }
  >["rules"],
): Promise<string | null> {
  if (!isResolvableTimeZone(rules.timeZone)) {
    return "The time zone the file's dates are days in is not one this platform knows.";
  }
  const unknown = await unknownMatterRuleReferences(database, rules as MatterMappingRules);
  if (unknown.members.length > 0) {
    return `These members are not in this firm: ${unknown.members.join(", ")}.`;
  }
  if (unknown.matterTypes.length > 0) {
    return `These matter types are not in this firm: ${unknown.matterTypes.join(", ")}.`;
  }
  return null;
}
