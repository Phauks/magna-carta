import { z } from "@hono/zod-openapi";
import {
  selectTransferRunStatement,
  type TransferRunRow,
} from "@magna-carta/record-transfer/transfer-run-statements";
import type { TransferRunId } from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import type { ProxyBatchDatabase } from "../../../firm-database/firm-database-proxy.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import type { RouteMeta } from "../../contracts/route-meta.ts";

// What the three record-transfer route modules share: the permission, the two route metas, the
// declared refusals, and the read of a run that every route under a run starts with.

export const PERMISSION = "firm:transferRecords" as const;

export function readMeta(operationId: string): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission: PERMISSION,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

export function writeMeta(operationId: string): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission: PERMISSION,
    resource: "firm",
    audited: true,
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

const problem = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: Problem } },
});

export const errors = {
  400: problem("The Idempotency-Key header is missing, or the body is empty"),
  401: problem("No valid session"),
  403: problem("The session member lacks firm:transferRecords"),
  404: problem("The run, file or pass is unknown to this firm"),
  409: problem("The run has ended, the file is already in the run, or the key is in progress"),
  413: problem("The file is larger than a source file may be"),
  422: problem("The request is not valid, or the Idempotency-Key was reused for another request"),
  429: problem("Rate limit exceeded"),
} as const;

const identifierParam = (name: string, prefix: string) =>
  z
    .string()
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9_-]{1,64}$`))
    .openapi({ param: { name, in: "path" } });

export const runParam = z.object({ runId: identifierParam("runId", "transferRun") });
export const fileParam = z.object({
  runId: identifierParam("runId", "transferRun"),
  fileId: identifierParam("fileId", "transferSourceFile"),
});
export const passParam = z.object({
  runId: identifierParam("runId", "transferRun"),
  passId: identifierParam("passId", "transferPass"),
});

export function notFound(c: Context, what: "run" | "file" | "pass") {
  return problemJson(c, {
    type: "not-found",
    title: "Not found",
    status: 404,
    detail: `This firm has no such transfer ${what}.`,
  });
}

export function runEnded(c: Context) {
  return problemJson(c, {
    type: "conflict",
    title: "The run has ended",
    status: 409,
    detail: "A run that was completed or abandoned takes no more files or passes. Start a new run.",
  });
}

export async function readRun(
  database: ProxyBatchDatabase,
  runId: string,
): Promise<TransferRunRow | null> {
  return selectTransferRunStatement(database, runId as TransferRunId).first<TransferRunRow>();
}

export const runIsOpen = (run: TransferRunRow): boolean =>
  run.completed_at === null && run.abandoned_at === null;
