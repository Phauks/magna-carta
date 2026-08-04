import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import {
  acceptStagedLinkStatement,
  filedMatterIdsForMessage,
  findByContentSha256,
  findByMessageIdValue,
  readMatterEmails,
  readMessageById,
  unlinkEmailFromMatterStatement,
} from "@magna-carta/data-access/email-filing-statements";
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { readInspectableSizeCap } from "@magna-carta/file-manager/upload-policy";
import { checkFilingConflict } from "@magna-carta/email-filing/seams";
import type { EmailMessageId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { identifierPathParam } from "../contracts/common.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { filterAccessibleMatters } from "../emails/matter-access.ts";
import type { EmailsCaptureMessage } from "../emails/capture-consumer.ts";

const matterParam = z.object({ matterId: identifierPathParam("matter", "matterId") });
const messageParam = z.object({
  matterId: identifierPathParam("matter", "matterId"),
  emailMessageId: identifierPathParam("emailMessage", "emailMessageId"),
});

const CaptureAck = z
  .object({ jobId: z.string(), status: z.literal("accepted") })
  .openapi("EmailCaptureAck");

const MatterEmailItem = z.object({
  emailMessageId: z.string(),
  threadId: z.string(),
  subject: z.string().nullable(),
  fromDisplay: z.string().nullable(),
  fromAddress: z.string().nullable(),
  sentAt: z.string().nullable(),
  receivedAt: z.string(),
  linkState: z.enum(["staged", "filed", "unlinked"]),
});
const MatterEmailList = z
  .object({ data: z.array(MatterEmailItem), nextCursor: z.string().nullable() })
  .openapi("MatterEmailList");

const MessageDetailResponse = z
  .object({
    emailMessageId: z.string(),
    threadId: z.string(),
    subject: z.string().nullable(),
    fromDisplay: z.string().nullable(),
    fromAddress: z.string().nullable(),
    sentAt: z.string().nullable(),
    receivedAt: z.string(),
    dkimVerdict: z.string(),
    participants: z.array(
      z.object({
        kind: z.string(),
        displayName: z.string().nullable(),
        address: z.string().nullable(),
        directoryEntityId: z.string().nullable(),
      }),
    ),
    // The matters this message is also filed to that the caller can access, and a bare count of the
    // rest — the wall-safe "also on ..." list, never naming a matter the caller is walled from.
    alsoFiledMatterIds: z.array(z.string()),
    hiddenMatterCount: z.number(),
  })
  .openapi("EmailMessageDetail");

const AlreadyFiledResponse = z
  .object({
    captured: z.boolean(),
    // The accessible matters it is filed to (empty for a caller walled from all of them — a generic
    // "captured by your firm" answer), and a count of the ones the caller cannot see.
    matters: z.array(z.string()),
    hiddenMatterCount: z.number(),
    totalMatterCount: z.number(),
  })
  .openapi("EmailAlreadyFiled");

const LinkActionAck = z
  .object({ emailMessageId: z.string(), matterId: z.string(), state: z.string() })
  .openapi("EmailLinkActionAck");

// ── RouteMeta. Email links are matter-rooted, so every route binds resource: "matter" (the files:*
// precedent); the firm-level reads access-filter to the caller's matters in the handler.

const captureMeta: RouteMeta = {
  operationId: "emails.file",
  surface: "app",
  authenticated: true,
  permission: "emails:file",
  resource: "matter",
  audited: true,
  idempotency: "optional",
  rateLimit: "expensive",
};

const listMeta: RouteMeta = {
  operationId: "emails.list",
  surface: "app",
  authenticated: true,
  permission: "emails:read",
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const getMeta: RouteMeta = {
  operationId: "emails.get",
  surface: "app",
  authenticated: true,
  permission: "emails:read",
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const alreadyFiledMeta: RouteMeta = {
  operationId: "emails.alreadyFiled",
  surface: "app",
  authenticated: true,
  permission: "emails:read",
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const acceptMeta: RouteMeta = {
  operationId: "emails.accept",
  surface: "app",
  authenticated: true,
  permission: "emails:manageLinks",
  resource: "matter",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

const unlinkMeta: RouteMeta = {
  operationId: "emails.unlink",
  surface: "app",
  authenticated: true,
  permission: "emails:manageLinks",
  resource: "matter",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

const captureRoute = defineOpenAPIRoute(captureMeta, {
  method: "post",
  path: "/api/v1/matters/{matterId}/emails",
  description:
    "File a raw email message (.eml or .msg bytes) to this matter. The bytes are staged and the parse, " +
    "dedup, thread-linking, and attachment extraction run off the request path; the response returns a " +
    "job identifier. A message the firm already holds is deduped to one record and linked, never " +
    "duplicated. This is the endpoint the native add-in's Save & File posts to.",
  request: {
    params: matterParam,
    body: { content: { "application/octet-stream": { schema: z.any() } }, required: true },
  },
  responses: {
    202: {
      description: "Capture accepted; filing runs off the request path",
      content: { "application/json": { schema: CaptureAck } },
    },
    400: {
      description: "Empty body",
      content: { "application/problem+json": { schema: Problem } },
    },
    401: {
      description: "No session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Missing emails:file",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "Unknown matter",
      content: { "application/problem+json": { schema: Problem } },
    },
    413: {
      description: "Message exceeds the inspectable-size cap",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const listRoute = defineOpenAPIRoute(listMeta, {
  method: "get",
  path: "/api/v1/matters/{matterId}/emails",
  description: "List the emails filed to this matter, newest first (cursor-paginated).",
  request: {
    params: matterParam,
    query: z.object({ cursor: z.string().optional() }),
  },
  responses: {
    200: {
      description: "A page of filed emails",
      content: { "application/json": { schema: MatterEmailList } },
    },
    401: {
      description: "No session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Missing emails:read",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const getRoute = defineOpenAPIRoute(getMeta, {
  method: "get",
  path: "/api/v1/emails/{emailMessageId}",
  description:
    "Read one captured message with its participants and the wall-safe list of other matters it is " +
    "filed to that the caller can access. A caller who can access none of the matters it is filed to " +
    "receives 404 (absence, never a leak of a walled matter).",
  request: {
    params: z.object({ emailMessageId: identifierPathParam("emailMessage", "emailMessageId") }),
  },
  responses: {
    200: {
      description: "The message and its wall-safe multi-matter context",
      content: { "application/json": { schema: MessageDetailResponse } },
    },
    401: {
      description: "No session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Missing emails:read",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "Unknown message, or one the caller cannot access",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const alreadyFiledRoute = defineOpenAPIRoute(alreadyFiledMeta, {
  method: "get",
  path: "/api/v1/emails/already-filed",
  description:
    "The wall-safe 'already filed' signal: given a Message-ID or a content hash, report whether the " +
    "firm has captured it and, if so, the matters it is filed to that the caller can access plus a bare " +
    "count of the rest. A caller walled from every matter it is filed to learns only that it was " +
    "captured, never a matter identity. This backs the add-in's 'Already filed to {Matter}' indicator.",
  request: {
    query: z
      .object({ messageId: z.string().optional(), contentHash: z.string().optional() })
      .refine((q) => q.messageId !== undefined || q.contentHash !== undefined, {
        message: "Provide messageId or contentHash.",
      }),
  },
  responses: {
    200: {
      description: "The wall-safe already-filed signal",
      content: { "application/json": { schema: AlreadyFiledResponse } },
    },
    401: {
      description: "No session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Missing emails:read",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description: "Neither messageId nor contentHash provided",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const acceptRoute = defineOpenAPIRoute(acceptMeta, {
  method: "post",
  path: "/api/v1/matters/{matterId}/emails/{emailMessageId}/accept",
  description:
    "Accept a staged email link onto this matter (staged → filed). Traverses the filing-time " +
    "conflict/ethical-wall hook before filing.",
  request: { params: messageParam },
  responses: {
    200: {
      description: "The link was filed (or was already filed)",
      content: { "application/json": { schema: LinkActionAck } },
    },
    401: {
      description: "No session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Missing emails:manageLinks",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "No staged link for this message on this matter",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const unlinkRoute = defineOpenAPIRoute(unlinkMeta, {
  method: "delete",
  path: "/api/v1/matters/{matterId}/emails/{emailMessageId}",
  description:
    "Unlink an email from this matter (the link → unlinked). Never deletes the message: it stays on any " +
    "other matters it is filed to.",
  request: { params: messageParam },
  responses: {
    200: {
      description: "The link was unlinked (or was already unlinked)",
      content: { "application/json": { schema: LinkActionAck } },
    },
    401: {
      description: "No session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Missing emails:manageLinks",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerEmailsRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // POST /matters/{matterId}/emails — stage + enqueue the capture, audit who initiated it.
  app.openapi(
    { ...captureRoute, middleware: chokepointMiddleware(chokepoint, captureRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      const { matterId } = c.req.valid("param");
      const body = c.req.raw.body;
      if (body === null) {
        return problemJson(c, {
          type: "validation",
          title: "Empty body",
          status: 400,
          detail: "Provide the email file bytes as the request body.",
        });
      }
      const sizeBytes = Number(c.req.header("content-length") ?? "0");
      const cap = await readInspectableSizeCap(firm.firmDatabase);
      if (sizeBytes > cap) {
        await body.cancel();
        return problemJson(c, {
          type: "upload-not-allowed",
          title: "Message too large to file",
          status: 413,
          detail: `The message exceeds this firm's inspectable-size cap (${cap} bytes).`,
        });
      }

      const bytes = new Uint8Array(await c.req.arrayBuffer());
      const jobId = crypto.randomUUID();
      const stagedR2Key = `emails/staging/${jobId}`;
      await c.env.R2.put(stagedR2Key, bytes);

      const now = (): string => new Date().toISOString();
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            domainAuditStatement(firm.firmDatabase, {
              event: "emails.capture_initiated",
              subjectId: matterId,
              actorUserId: userId,
              clock: { now },
              metadata: { jobId, capturedVia: "api" },
            }),
          ],
          outboxMessages: [],
        },
        { now },
      );

      const message: EmailsCaptureMessage = {
        firmId,
        bucketName: firm.bucketName,
        stagedR2Key,
        capturedVia: "api",
        matterId,
        captureToken: null,
        linkedBy: userId,
        // The API entrance is already authenticated to this matter with emails:file, so it files in one
        // step (the conflict hook may still hold it at staged).
        acceptOnCapture: true,
        jobId,
      };
      await c.env.EMAILS_CAPTURE.send(message);

      return c.json({ jobId, status: "accepted" as const }, 202);
    },
  );

  // GET /matters/{matterId}/emails — the matter's filed emails.
  app.openapi(
    { ...listRoute, middleware: chokepointMiddleware(chokepoint, listRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      const { cursor } = c.req.valid("query");
      const page = await readMatterEmails(firm.firmDatabase, matterId, cursor);
      return c.json(
        {
          data: page.data.map((item) => ({
            emailMessageId: item.emailMessageId,
            threadId: item.threadId,
            subject: item.subject,
            fromDisplay: item.fromDisplay,
            fromAddress: item.fromAddress,
            sentAt: item.sentAt,
            receivedAt: item.receivedAt,
            linkState: item.linkState,
          })),
          nextCursor: page.nextCursor,
        },
        200,
      );
    },
  );

  // GET /emails/already-filed — the wall-safe signal. Registered BEFORE the /emails/{emailMessageId}
  // param route so the static path wins (otherwise "already-filed" is parsed as a message id).
  app.openapi(
    { ...alreadyFiledRoute, middleware: chokepointMiddleware(chokepoint, alreadyFiledRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { messageId, contentHash } = c.req.valid("query");
      const emailMessageId =
        messageId !== undefined
          ? await findByMessageIdValue(firm.firmDatabase, messageId)
          : contentHash !== undefined
            ? await findByContentSha256(firm.firmDatabase, contentHash)
            : null;
      if (emailMessageId === null) {
        return c.json(
          { captured: false, matters: [], hiddenMatterCount: 0, totalMatterCount: 0 },
          200,
        );
      }
      const filed = await filedMatterIdsForMessage(firm.firmDatabase, emailMessageId);
      const visible = await filterAccessibleMatters(firm, userId, filed);
      return c.json(
        {
          captured: true,
          matters: visible,
          hiddenMatterCount: filed.length - visible.length,
          totalMatterCount: filed.length,
        },
        200,
      );
    },
  );

  // GET /emails/{emailMessageId} — one message + the wall-safe "also on" list.
  app.openapi(
    { ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { emailMessageId } = c.req.valid("param");
      const detail = await readMessageById(firm.firmDatabase, emailMessageId as EmailMessageId);
      if (detail === null) {
        return problemJson(c, {
          type: "not-found",
          title: "Email not found",
          status: 404,
          detail: "No such email, or you cannot access it.",
        });
      }
      const filed = await filedMatterIdsForMessage(
        firm.firmDatabase,
        emailMessageId as EmailMessageId,
      );
      const visible = await filterAccessibleMatters(firm, userId, filed);
      // A caller who can access none of the matters it is filed to sees it as absent — never a leak.
      if (filed.length > 0 && visible.length === 0) {
        return problemJson(c, {
          type: "not-found",
          title: "Email not found",
          status: 404,
          detail: "No such email, or you cannot access it.",
        });
      }
      return c.json(
        {
          emailMessageId: detail.emailMessageId,
          threadId: detail.threadId,
          subject: detail.subject,
          fromDisplay: detail.fromDisplay,
          fromAddress: detail.fromAddress,
          sentAt: detail.sentAt,
          receivedAt: detail.receivedAt,
          dkimVerdict: detail.dkimVerdict,
          participants: detail.participants,
          alsoFiledMatterIds: visible,
          hiddenMatterCount: filed.length - visible.length,
        },
        200,
      );
    },
  );

  // POST /matters/{matterId}/emails/{emailMessageId}/accept — staff-accept a staged link.
  app.openapi(
    { ...acceptRoute, middleware: chokepointMiddleware(chokepoint, acceptRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      const { matterId, emailMessageId } = c.req.valid("param");
      const detail = await readMessageById(firm.firmDatabase, emailMessageId as EmailMessageId);
      if (detail === null) {
        return problemJson(c, {
          type: "not-found",
          title: "No staged link",
          status: 404,
          detail: "No staged email link for this message on this matter.",
        });
      }
      // Filing traverses the conflict/ethical-wall hook (a no-op today; the engine drops in here).
      checkFilingConflict({
        firmId,
        matterId,
        emailMessageId,
        participantAddresses: detail.participants
          .map((p) => p.address)
          .filter((a): a is string => a !== null),
      });
      const now = (): string => new Date().toISOString();
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            acceptStagedLinkStatement(
              firm.firmDatabase,
              { emailMessageId: emailMessageId as EmailMessageId, matterId, linkedBy: userId },
              now(),
            ),
            domainAuditStatement(firm.firmDatabase, {
              event: "emails.filed",
              subjectId: emailMessageId,
              actorUserId: userId,
              clock: { now },
              metadata: { matterId },
            }),
          ],
          outboxMessages: [],
        },
        { now },
      );
      return c.json({ emailMessageId, matterId, state: "filed" }, 200);
    },
  );

  // DELETE /matters/{matterId}/emails/{emailMessageId} — unlink (never deletes the message).
  app.openapi(
    { ...unlinkRoute, middleware: chokepointMiddleware(chokepoint, unlinkRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { matterId, emailMessageId } = c.req.valid("param");
      const now = (): string => new Date().toISOString();
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            unlinkEmailFromMatterStatement(
              firm.firmDatabase,
              { emailMessageId: emailMessageId as EmailMessageId, matterId },
              now(),
            ),
            domainAuditStatement(firm.firmDatabase, {
              event: "emails.unlinked",
              subjectId: emailMessageId,
              actorUserId: userId,
              clock: { now },
              metadata: { matterId },
            }),
          ],
          outboxMessages: [],
        },
        { now },
      );
      return c.json({ emailMessageId, matterId, state: "unlinked" }, 200);
    },
  );
}
