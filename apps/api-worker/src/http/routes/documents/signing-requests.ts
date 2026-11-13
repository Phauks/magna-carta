import type { OpenAPIHono } from "@hono/zod-openapi";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import {
  commitEffectBatch,
  GuardedWriteRefusedError,
  type EffectWrite,
} from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { SigningRequestId, UserId } from "@magna-carta/identifiers/types";
import { ensureReady, loadDocument } from "@magna-carta/pdf";
import pdfWasmModule from "@magna-carta/pdf/src/pkg/pdf_core_bg.wasm";
import { signingRequestBody } from "../../../signing/request-contract.ts";
import {
  SigningRequestRefusal,
  cancelRequest,
  createDraft,
  readRequestDetail,
  remindSigners,
  saveDraft,
  sendRequest,
  type ServiceOptions,
} from "../../../signing/request-service.ts";
import {
  listRequestsForFile,
  readFileForSigning,
  readMemberName,
  readSigners,
  readVersionObjectKey,
} from "../../../signing/statements.ts";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { problemJson, type ProblemResponse } from "../../contracts/problem.ts";

import {
  createRoute,
  listRoute,
  readRoute,
  saveRoute,
  sendRoute,
  remindRoute,
  cancelRoute,
} from "./signing-request-routes.ts";

// A member's side of sending a document for signature: start a request on a file, save its signers
// and fields while it is a draft, send it, follow it, remind and cancel. The decisions are the
// signing package's (packages/signing/src/request.ts and request-service.ts); this module reads the
// file, hands the package the facts only the server may establish (the hash of the bytes sent and
// their page count), and commits what it returns with an audit line. Who is told, and how, is the
// outside-signer work that follows; a request sent here is recorded and waits.

type App = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

const NOT_FOUND = {
  type: "not-found",
  title: "Not found",
  status: 404,
  detail: "No such request in this firm.",
} as const;

async function serviceOptions(database: SqlDatabase, userId: UserId): Promise<ServiceOptions> {
  return {
    now: new Date().toISOString(),
    actorUserId: userId,
    actorName: await readMemberName(database, userId),
  };
}

/** Commit a request's writes with one audit line naming the request and nothing it holds. */
async function commitWithAudit(
  database: Parameters<typeof commitEffectBatch>[0],
  effect: EffectWrite,
  audit: {
    readonly event: string;
    readonly userId: UserId;
    readonly requestId: string;
    readonly now: string;
  },
): Promise<void> {
  await commitEffectBatch(
    database,
    {
      statements: [
        ...effect.statements,
        insertAuditLogStatement(database, {
          id: newIdentifier("auditLog"),
          event: audit.event,
          actorUserId: audit.userId,
          subjectId: audit.requestId,
          metadata: {},
          now: audit.now,
        }),
      ],
      outboxMessages: effect.outboxMessages,
    },
    { now: () => audit.now },
  );
}

function refusal(
  c: Context,
  error: unknown,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> | undefined {
  if (error instanceof GuardedWriteRefusedError) {
    return problemJson(c, {
      type: "signing-request-moved",
      title: "The request changed",
      status: 409,
      detail: "Someone else changed this request at the same time. Open it again and retry.",
    });
  }
  if (!(error instanceof SigningRequestRefusal)) return undefined;
  if (error.code === "not-found") return problemJson(c, NOT_FOUND);
  const status = error.code === "invalid" ? 422 : 409;
  return problemJson(c, {
    type: "signing-request-refused",
    title: status === 422 ? "The request cannot be sent yet" : "The request cannot be changed now",
    status,
    detail: error.message,
  });
}

/** SHA-256 of the bytes, lowercase hex. */
async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function registerSigningRequestRoutes(app: App, chokepoint: Chokepoint): void {
  app.openapi(
    { ...createRoute, middleware: chokepointMiddleware(chokepoint, createRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { id } = c.req.valid("param");
      const file = await readFileForSigning(firm.firmDatabase, id);
      if (file === undefined) {
        return problemJson(c, {
          ...NOT_FOUND,
          detail: "No such file with a clean current version.",
        });
      }
      if (file.contentType !== "application/pdf") {
        return problemJson(c, {
          type: "signing-not-a-pdf",
          title: "Only a PDF can be sent for signature",
          status: 422,
          detail: "Convert the file to PDF first, then send the PDF for signature.",
        });
      }
      const options = await serviceOptions(firm.firmDatabase, userId);
      const draft = createDraft(
        firm.firmDatabase,
        {
          matterId: file.matterId,
          fileId: file.fileId,
          fileVersionId: file.versionId,
          title: file.name,
        },
        options,
      );
      await commitWithAudit(firm.firmDatabase, draft.effect, {
        event: "esign.request_created",
        userId,
        requestId: draft.id,
        now: options.now,
      });
      const detail = await readRequestDetail(firm.firmDatabase, draft.id);
      if (detail === undefined) return problemJson(c, NOT_FOUND);
      return c.json(signingRequestBody(detail), 201);
    },
  );

  app.openapi(
    { ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const requests = await listRequestsForFile(firm.firmDatabase, id);
      const counted = await Promise.all(
        requests.map(async (request) => {
          const signers = await readSigners(firm.firmDatabase, request.id);
          return {
            id: request.id,
            fileId: request.fileId,
            fileVersionId: request.fileVersionId,
            title: request.title,
            status: request.status,
            sentAt: request.sentAt,
            completedAt: request.completedAt,
            createdAt: request.createdAt,
            signerCount: signers.length,
            signedCount: signers.filter((signer) => signer.status === "signed").length,
          };
        }),
      );
      return c.json({ requests: counted }, 200);
    },
  );

  app.openapi(
    { ...readRoute, middleware: chokepointMiddleware(chokepoint, readRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { requestId } = c.req.valid("param");
      const detail = await readRequestDetail(firm.firmDatabase, requestId);
      if (detail === undefined) return problemJson(c, NOT_FOUND);
      return c.json(signingRequestBody(detail), 200);
    },
  );

  app.openapi(
    { ...saveRoute, middleware: chokepointMiddleware(chokepoint, saveRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { requestId } = c.req.valid("param");
      const body = c.req.valid("json");
      const options = await serviceOptions(firm.firmDatabase, userId);
      try {
        const effect = await saveDraft(
          firm.firmDatabase,
          requestId,
          {
            ...body,
            signers: body.signers.map((signer) => ({
              key: signer.key,
              name: signer.name,
              email: signer.email,
              attribution: signer.attribution,
              ...(signer.userId === undefined ? {} : { userId: signer.userId as UserId }),
            })),
          },
          options,
        );
        await commitWithAudit(firm.firmDatabase, effect, {
          event: "esign.draft_saved",
          userId,
          requestId,
          now: options.now,
        });
      } catch (error) {
        const answer = refusal(c, error);
        if (answer !== undefined) return answer;
        throw error;
      }
      const detail = await readRequestDetail(firm.firmDatabase, requestId);
      if (detail === undefined) return problemJson(c, NOT_FOUND);
      return c.json(signingRequestBody(detail), 200);
    },
  );

  app.openapi(
    { ...sendRoute, middleware: chokepointMiddleware(chokepoint, sendRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { requestId } = c.req.valid("param");
      const current = await readRequestDetail(firm.firmDatabase, requestId);
      if (current === undefined) return problemJson(c, NOT_FOUND);
      const key = await readVersionObjectKey(firm.firmDatabase, current.request.fileVersionId);
      const object =
        key === undefined ? null : await resolveFirmBucket(c.env, firm.bucketName).bucket.get(key);
      if (object === null) {
        return problemJson(c, {
          ...NOT_FOUND,
          detail: "The version this request was drafted on is no longer available.",
        });
      }
      const bytes = new Uint8Array(await object.arrayBuffer());
      let pageCount: number;
      try {
        await ensureReady(pdfWasmModule);
        const document = await loadDocument(bytes.slice());
        pageCount = document.pageCount;
        document.free();
      } catch {
        return problemJson(c, {
          type: "signing-not-a-pdf",
          title: "The document could not be read",
          status: 422,
          detail: "This PDF could not be opened, so it cannot be sent for signature.",
        });
      }
      const options = await serviceOptions(firm.firmDatabase, userId);
      try {
        const sent = await sendRequest(
          firm.firmDatabase,
          requestId as SigningRequestId,
          { sha256: await sha256Hex(bytes), pageCount },
          options,
        );
        await commitWithAudit(firm.firmDatabase, sent.effect, {
          event: "esign.request_sent",
          userId,
          requestId,
          now: options.now,
        });
      } catch (error) {
        const answer = refusal(c, error);
        if (answer !== undefined) return answer;
        throw error;
      }
      const detail = await readRequestDetail(firm.firmDatabase, requestId);
      if (detail === undefined) return problemJson(c, NOT_FOUND);
      return c.json(signingRequestBody(detail), 200);
    },
  );

  app.openapi(
    { ...remindRoute, middleware: chokepointMiddleware(chokepoint, remindRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { requestId } = c.req.valid("param");
      const options = await serviceOptions(firm.firmDatabase, userId);
      try {
        const reminded = await remindSigners(firm.firmDatabase, requestId, options);
        await commitWithAudit(firm.firmDatabase, reminded.effect, {
          event: "esign.signers_reminded",
          userId,
          requestId,
          now: options.now,
        });
      } catch (error) {
        const answer = refusal(c, error);
        if (answer !== undefined) return answer;
        throw error;
      }
      const detail = await readRequestDetail(firm.firmDatabase, requestId);
      if (detail === undefined) return problemJson(c, NOT_FOUND);
      return c.json(signingRequestBody(detail), 200);
    },
  );

  app.openapi(
    { ...cancelRoute, middleware: chokepointMiddleware(chokepoint, cancelRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { requestId } = c.req.valid("param");
      const { reason } = c.req.valid("json");
      const options = await serviceOptions(firm.firmDatabase, userId);
      try {
        const cancelled = await cancelRequest(firm.firmDatabase, requestId, reason, options);
        await commitWithAudit(firm.firmDatabase, cancelled.effect, {
          event: "esign.request_voided",
          userId,
          requestId,
          now: options.now,
        });
      } catch (error) {
        const answer = refusal(c, error);
        if (answer !== undefined) return answer;
        throw error;
      }
      const detail = await readRequestDetail(firm.firmDatabase, requestId);
      if (detail === undefined) return problemJson(c, NOT_FOUND);
      return c.json(signingRequestBody(detail), 200);
    },
  );
}
