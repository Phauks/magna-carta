import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { TransferRunId } from "@magna-carta/identifiers/types";
import {
  StartTransferRunRequest,
  TransferRunEndedResponse,
  TransferRunListResponse,
  TransferRunResponse,
  type TransferRunBody,
  type TransferRunResponseBody,
} from "@magna-carta/record-transfer/contract";
import {
  selectTransferPassesStatement,
  type TransferPassRow,
} from "@magna-carta/record-transfer/transfer-pass-statements";
import {
  abandonTransferRunEffect,
  acceptTransferRunEffect,
  startTransferRunEffect,
  transferPassStateOf,
} from "@magna-carta/record-transfer/transfer-requests";
import {
  selectAllTransferRunsStatement,
  type TransferRunRow,
} from "@magna-carta/record-transfer/transfer-run-statements";
import {
  selectTransferSourceFilesStatement,
  type TransferSourceFileRow,
} from "@magna-carta/record-transfer/transfer-source-file-statements";
import {
  transferPassBody,
  transferRunBody,
  transferSourceFileBody,
} from "@magna-carta/record-transfer/transfer-views";
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
  readMeta,
  readRun,
  runEnded,
  runIsOpen,
  runParam,
  writeMeta,
} from "./shared.ts";

// A transfer run: the one sitting, rehearsal or cutover, that every file given and every record
// brought in is recorded under. Starting one writes nothing but the run and its audit row; reading
// one answers the run with its files and its passes, which is everything the workspace screen
// shows. The bodies are declared in packages/record-transfer/src/contract.ts.

const listRoute = defineOpenAPIRoute(readMeta("recordTransfer.listRuns"), {
  method: "get",
  path: "/api/v1/record-transfer/runs",
  description: "Every transfer run this firm has started, newest first.",
  responses: {
    200: {
      description: "The firm's transfer runs",
      content: { "application/json": { schema: TransferRunListResponse } },
    },
    401: errors[401],
    403: errors[403],
    429: errors[429],
  },
});

const startRoute = defineOpenAPIRoute(writeMeta("recordTransfer.startRun"), {
  method: "post",
  path: "/api/v1/record-transfer/runs",
  description:
    "Starts a transfer run for the system the firm is leaving. A run holds the files given to it and every pass made over them; a rehearsal and the cutover are separate runs.",
  request: {
    headers: idempotencyKeyHeader,
    body: { required: true, content: { "application/json": { schema: StartTransferRunRequest } } },
  },
  responses: {
    201: {
      description: "The run that was started",
      content: { "application/json": { schema: TransferRunResponse } },
    },
    400: errors[400],
    401: errors[401],
    403: errors[403],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

const getRoute = defineOpenAPIRoute(readMeta("recordTransfer.getRun"), {
  method: "get",
  path: "/api/v1/record-transfer/runs/{runId}",
  description:
    "One run with the files given to it and the passes made over them, each pass with its state and, once finished, its counts.",
  request: { params: runParam },
  responses: {
    200: {
      description: "The run, its files and its passes",
      content: { "application/json": { schema: TransferRunResponse } },
    },
    401: errors[401],
    403: errors[403],
    404: errors[404],
    429: errors[429],
  },
});

// THE TWO ENDINGS. Accepting a run says its records are the firm's records now: the run is marked
// complete and one message asks for the conflicts checks that were withheld while matters arrived
// (src/background/record-transfer/run-accepted-consumer.ts). Abandoning stops a run and announces
// nothing. Neither removes a record or a link, and neither is undone: the way on is a new run.
const endedResponses = {
  200: {
    description: "The run as it now stands",
    content: { "application/json": { schema: TransferRunEndedResponse } },
  },
  400: errors[400],
  401: errors[401],
  403: errors[403],
  404: errors[404],
  409: errors[409],
  422: errors[422],
  429: errors[429],
} as const;

const acceptRoute = defineOpenAPIRoute(writeMeta("recordTransfer.acceptRun"), {
  method: "post",
  path: "/api/v1/record-transfer/runs/{runId}/accept",
  description:
    "Accepts a run: marks it complete and asks for a conflicts check of every live matter it brought in. Refused while a pass is waiting or running. An accepted run takes no more files or passes.",
  request: { params: runParam, headers: idempotencyKeyHeader },
  responses: endedResponses,
});

const abandonRoute = defineOpenAPIRoute(writeMeta("recordTransfer.abandonRun"), {
  method: "post",
  path: "/api/v1/record-transfer/runs/{runId}/abandon",
  description:
    "Stops a run without accepting it. The records it brought in and their links stay, and no conflicts check is asked for them. Refused while a pass is waiting or running.",
  request: { params: runParam, headers: idempotencyKeyHeader },
  responses: endedResponses,
});

export function registerTransferRunRoutes(app: AppRouter, chokepoint: Chokepoint): void {
  app.openapi(
    { ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { results } = await selectAllTransferRunsStatement(
        firm.firmDatabase,
      ).all<TransferRunRow>();
      return c.json({ runs: results.map(transferRunBody) }, 200);
    },
  );

  app.openapi(
    { ...startRoute, middleware: chokepointMiddleware(chokepoint, startRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const body = c.req.valid("json");
      const now = new Date().toISOString();
      const id = newIdentifier("transferRun") as TransferRunId;
      const run: TransferRunBody = {
        id,
        sourceSystem: body.sourceSystem,
        label: body.label,
        startedBy: userId,
        startedAt: now,
        completedAt: null,
        abandonedAt: null,
      };
      const answer: TransferRunResponseBody = { run, files: [], passes: [] };
      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now: () => now,
        effect: async () => ({
          write: startTransferRunEffect(
            firm.firmDatabase,
            { id, sourceSystem: run.sourceSystem, label: run.label },
            { actorUserId: userId, now },
          ),
          responseCode: 201,
          responseBody: canonicalJsonStringify(answer),
        }),
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      const recorded =
        result.responseBody === null
          ? answer
          : (JSON.parse(result.responseBody) as TransferRunResponseBody);
      return c.json(recorded, 201);
    },
  );

  app.openapi(
    { ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { runId } = c.req.valid("param");
      const run = await readRun(firm.firmDatabase, runId);
      if (run === null) return notFound(c, "run");
      const [files, passes] = await Promise.all([
        selectTransferSourceFilesStatement(firm.firmDatabase, run.id).all<TransferSourceFileRow>(),
        selectTransferPassesStatement(firm.firmDatabase, run.id).all<TransferPassRow>(),
      ]);
      const now = new Date().toISOString();
      const body: TransferRunResponseBody = {
        run: transferRunBody(run),
        files: files.results.map(transferSourceFileBody),
        passes: passes.results.map((pass) => transferPassBody(pass, now)),
      };
      return c.json(body, 200);
    },
  );

  for (const [route, ending] of [
    [acceptRoute, "accept"],
    [abandonRoute, "abandon"],
  ] as const) {
    app.openapi({ ...route, middleware: chokepointMiddleware(chokepoint, route) }, async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { runId } = c.req.valid("param");
      const now = new Date().toISOString();
      const run = await readRun(firm.firmDatabase, runId);
      if (run === null) return notFound(c, "run");
      if (!runIsOpen(run)) {
        // Asking again for the ending a run already has is answered with the run, so a press
        // delivered twice reads the same either time. Asking for the other ending is refused.
        const same = ending === "accept" ? run.completed_at !== null : run.abandoned_at !== null;
        return same ? c.json({ run: transferRunBody(run) }, 200) : runEnded(c);
      }
      const passes = await selectTransferPassesStatement(
        firm.firmDatabase,
        run.id,
      ).all<TransferPassRow>();
      // A stalled pass has lost its job and will write nothing more, so it holds nothing up.
      const working = passes.results.some((pass) => {
        const state = transferPassStateOf(pass, now);
        return state === "requested" || state === "running";
      });
      if (working) {
        return problemJson(c, {
          type: "conflict",
          title: "A pass is still running",
          status: 409,
          detail: "Wait for the run's passes to end before accepting or stopping it.",
        });
      }
      const actor = { actorUserId: userId, now };
      const answer: { run: TransferRunBody } = {
        run: {
          ...transferRunBody(run),
          ...(ending === "accept" ? { completedAt: now } : { abandonedAt: now }),
        },
      };
      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now: () => now,
        effect: async () => ({
          write:
            ending === "accept"
              ? acceptTransferRunEffect(firm.firmDatabase, run.id, actor)
              : abandonTransferRunEffect(firm.firmDatabase, run.id, actor),
          responseCode: 200,
          responseBody: canonicalJsonStringify(answer),
        }),
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      const recorded =
        result.responseBody === null
          ? answer
          : (JSON.parse(result.responseBody) as { run: TransferRunBody });
      return c.json(recorded, 200);
    });
  }
}
