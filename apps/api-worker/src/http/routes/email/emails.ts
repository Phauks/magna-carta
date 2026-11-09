import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import {
  acceptStagedLinkStatement,
  filedMatterIdsForMessage,
  findByContentSha256,
  findByMessageIdValue,
  readEmailMatterLinksForMessage,
  readMatterEmails,
  readMessageById,
  unlinkEmailFromMatterStatement,
} from "@magna-carta/data-access/email-filing-statements";
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import {
  checkUploadPolicy,
  readInspectableSizeCap,
  readUploadPolicy,
} from "@magna-carta/file-manager/upload-policy";
import { FileManagerValidationError } from "@magna-carta/file-manager/validation";
import { checkFilingConflict } from "@magna-carta/email-filing/seams";
import { EMAIL_FILED_TOPIC } from "@magna-carta/email-filing/topics";
import {
  fileNameForMessageFormat,
  mediaTypeForMessageFormat,
  sniffMessageFormat,
  MAX_CAPTURED_MESSAGE_BYTES,
} from "@magna-carta/email-filing/message-format";
import { selectMatterStatement } from "@magna-carta/matters/matter-statements";
import type { EmailMessageId, MatterId } from "@magna-carta/identifiers/types";
import { firmScopedObjectDimensions } from "@magna-carta/object-dimensions/dimensions";
import type { Bindings } from "../../../bindings.ts";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables, FirmContext } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
import { filterAccessibleMatters } from "../../../emails/matter-access.ts";
import type { EmailsCaptureMessage } from "../../../emails/capture-types.ts";

const matterParam = z.object({ matterId: identifierPathParam("matter", "matterId") });
const messageParam = z.object({
  matterId: identifierPathParam("matter", "matterId"),
  emailMessageId: identifierPathParam("emailMessage", "emailMessageId"),
});

const CaptureAck = z
  .object({ jobId: z.string(), status: z.literal("accepted") })
  .openapi("EmailCaptureAck");

// Which client filed the message. It is provenance, recorded on the message row beside the forward/CC
// entrance's own value — an add-in capture reads the original message intact, a manual upload does
// not, and later work (the auto-file guardrail, the correspondence view) needs to tell them apart.
// Only the two entrances that post here are accepted: `forward` belongs to the Email Worker and `sync`
// to the credentialed adapter, and neither could be claimed honestly by an API caller.
const CaptureSource = z.enum(["api", "addin"]);

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
    // The signature adjudication. Informational only: nothing was dropped, refused, or auto-filed on
    // it. Every inconclusive outcome is `unverified` with the reason saying which one, and the domain
    // is present only when a signature actually verified.
    dkimVerdict: z.string(),
    dkimVerdictReason: z.string().nullable(),
    dkimVerifiedDomain: z.string().nullable(),
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
  // Optional, and it has to be: the chokepoint's required-idempotency gate fingerprints a request by
  // reading its body through Hono's text cache, which would round-trip these raw message bytes through
  // a UTF-8 decode and hand the handler back a corrupted message. This route therefore honours an
  // Idempotency-Key itself, in the handler, against the bytes it actually received.
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
    "duplicated. This is the endpoint the native add-in's Save & File posts to: send an Idempotency-Key " +
    "and a retried submission converges on the capture it already started rather than starting another.",
  request: {
    params: matterParam,
    query: z.object({ source: CaptureSource.optional() }),
    headers: idempotencyKeyHeader,
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
      description: "Unknown matter, or one the caller cannot access",
      content: { "application/problem+json": { schema: Problem } },
    },
    409: {
      description: "A request with this Idempotency-Key is still in progress",
      content: { "application/problem+json": { schema: Problem } },
    },
    413: {
      description: "Message exceeds the capture size limit",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description:
        "The bytes are not an email message, the firm's upload policy refuses the format, or the " +
        "Idempotency-Key was reused with a different payload",
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

const unlinkRoute = defineOpenAPIRoute(
  {
    ...unlinkMeta,
    reversal: {
      kind: "none",
      reason:
        "The link row is retained as unlinked, but nothing re-files an already-captured message onto a matter it was unlinked from. Filing it again means filing the bytes again.",
    },
  },
  {
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
  },
);

type EmailsContext = Context<{ Bindings: Bindings; Variables: AppVariables }>;

// Can this caller file into this matter? Existence and access are answered together and reported the
// same way, because reporting them separately is what turns a filing endpoint into an oracle for a
// walled matter's existence.
async function resolveFilingMatter(
  firm: FirmContext,
  userId: string,
  matterId: MatterId,
): Promise<boolean> {
  const matter = await selectMatterStatement(firm.firmDatabase, matterId).all<{ id: string }>();
  if (matter.results[0] === undefined) return false;
  const visible = await filterAccessibleMatters(firm, userId, [matterId]);
  return visible.length > 0;
}

function oversizeProblem(c: EmailsContext, cap: number): ProblemResponse<413> {
  return problemJson(c, {
    type: "upload-not-allowed",
    title: "Message too large to file",
    status: 413,
    detail: `The message exceeds this firm's capture size limit (${cap} bytes).`,
  });
}

// A stable, opaque capture job id for one (firm, matter, Idempotency-Key). Hashed rather than
// concatenated so the client's key never appears in an R2 object name, and firm-scoped so a key chosen
// by one firm can never address another firm's staged bytes.
async function deriveCaptureJobId(
  firmId: string,
  matterId: string,
  idempotencyKey: string,
): Promise<string> {
  const source = new TextEncoder().encode(`${firmId}:${matterId}:${idempotencyKey}`);
  return (await sha256Hex(source)).slice(0, 32);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function registerEmailsRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // POST /matters/{matterId}/emails — guard, stage, enqueue the capture, audit who initiated it.
  //
  // The guards run in cost order and all of them run BEFORE anything is staged: an unknown matter, a
  // payload that is not mail, and an oversize message are each refused at the door with a reason the
  // caller can act on, rather than accepted and left to fail in the consumer where the only outcomes
  // are a retry loop and a dead letter.
  app.openapi(
    { ...captureRoute, middleware: chokepointMiddleware(chokepoint, captureRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      const idempotencyKey = c.req.header("idempotency-key");
      const { matterId } = c.req.valid("param");
      const { source } = c.req.valid("query");
      const body = c.req.raw.body;
      if (body === null) {
        return problemJson(c, {
          type: "validation",
          title: "Empty body",
          status: 400,
          detail: "Provide the email file bytes as the request body.",
        });
      }

      // Filing into a matter that does not exist, or one this caller cannot reach, is answered as
      // absence — the same 404 either way, so the reply never distinguishes "no such matter" from
      // "walled from you".
      const accessible = await resolveFilingMatter(firm, userId, matterId);
      if (!accessible) {
        await body.cancel();
        return problemJson(c, {
          type: "not-found",
          title: "Matter not found",
          status: 404,
          detail: "No such matter, or you cannot access it.",
        });
      }

      // Both capture entrances bound to the same ceiling, so "too large to file" means one thing
      // whichever door the message came through; a firm that has tightened its own inspectable-size
      // cap tightens this too.
      const cap = Math.min(
        await readInspectableSizeCap(firm.firmDatabase),
        MAX_CAPTURED_MESSAGE_BYTES,
      );
      const declaredSize = Number(c.req.header("content-length") ?? "0");
      if (Number.isFinite(declaredSize) && declaredSize > cap) {
        await body.cancel();
        return oversizeProblem(c, cap);
      }

      const bytes = new Uint8Array(await c.req.arrayBuffer());
      // A declared Content-Length is a claim, not a measurement — a chunked or mis-declared request
      // reaches here having never been checked, so the real length is what decides.
      if (bytes.byteLength > cap) return oversizeProblem(c, cap);
      if (bytes.byteLength === 0) {
        return problemJson(c, {
          type: "validation",
          title: "Empty body",
          status: 400,
          detail: "Provide the email file bytes as the request body.",
        });
      }

      // The same policy the ingest chokepoint applies to an uploaded file, applied to the message
      // itself: the format is taken from the bytes rather than from a declared header, and the firm's
      // own allowed-type and blocked-extension policy decides. A firm that removes mail from its
      // policy stops accepting mail at this entrance too, which is the point of having one policy.
      const format = sniffMessageFormat(bytes);
      const mediaType = mediaTypeForMessageFormat(format);
      if (mediaType === null) {
        return problemJson(c, {
          type: "validation",
          title: "Not an email message",
          status: 422,
          detail: "The bytes could not be read as an .eml or .msg message.",
        });
      }
      try {
        checkUploadPolicy(await readUploadPolicy(firm.firmDatabase), {
          sizeBytes: bytes.byteLength,
          contentType: mediaType,
          fileName: fileNameForMessageFormat(format),
        });
      } catch (thrown) {
        if (thrown instanceof FileManagerValidationError) {
          return problemJson(c, {
            type: "upload-not-allowed",
            title: "This firm's upload policy refuses this message",
            status: 422,
            detail: "The firm's upload policy does not accept this message format.",
          });
        }
        throw thrown;
      }

      // The capture job id is derived from the caller's Idempotency-Key rather than minted fresh, so
      // every layer below converges on a retry: the staged object overwrites itself, the queued job
      // carries the same id, and the consumer's own idempotency record on that id turns a redelivered
      // job into a no-op. The firm is hashed in so one firm's key can never name another's staged
      // bytes. A caller that sends no key gets a fresh id and the old behaviour — each submission is
      // its own capture.
      const jobId =
        idempotencyKey === undefined
          ? crypto.randomUUID()
          : await deriveCaptureJobId(firmId, matterId, idempotencyKey);

      // The fingerprint is over the bytes actually received, not a re-read of the body, so reusing one
      // key for a different message is caught rather than silently answered with the first capture.
      const now = (): string => new Date().toISOString();
      const outcome = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotencyKey,
        fingerprint: await sha256Hex(bytes),
        now,
        effect: async () => ({
          write: {
            statements: [
              domainAuditStatement(firm.firmDatabase, {
                event: "emails.capture_initiated",
                subjectId: matterId,
                actorUserId: userId,
                clock: { now },
                metadata: { jobId, capturedVia: source ?? "api" },
              }),
            ],
            outboxMessages: [],
          },
          responseCode: 202,
          responseBody: canonicalJsonStringify({ jobId, status: "accepted" }),
        }),
      });
      if (outcome.kind === "in-progress" || outcome.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, outcome);
      }

      // Staged and enqueued on the replay path too, not just the first execution: the job id is the
      // same either way and the consumer is idempotent on it, so re-sending costs nothing — while a
      // first attempt that committed its audit and then died before enqueueing would otherwise leave a
      // capture the firm never receives and a retry that cheerfully reports success.
      const stagedR2Key = `emails/staging/${jobId}`;
      // Staged mail carries no matter even when the caller named one: what is filed onto a matter is
      // the captured message record, and the staged bytes are consumed and dropped by the capture.
      // Written through the same seam the capture consumer reads back through, on the bucket name the
      // message below carries — the staging PUT and the consumer GET can never name two buckets.
      await resolveFirmBucket(c.env, firm.bucketName).bucket.put(stagedR2Key, bytes, {
        customMetadata: firmScopedObjectDimensions("email-staging"),
      });
      const message: EmailsCaptureMessage = {
        firmId,
        bucketName: firm.bucketName,
        stagedR2Key,
        // Provenance the caller declares, defaulting to the manual uploader. The add-in names itself so
        // a capture that carried an intact original is distinguishable later.
        capturedVia: source ?? "api",
        matterId,
        captureToken: null,
        linkedBy: userId,
        // The API entrance is already authenticated to this matter with emails:file, so it files in one
        // step (the conflict hook may still hold it at staged).
        acceptOnCapture: true,
        jobId,
      };
      await c.env.EMAILS_CAPTURE.send(message);

      if (outcome.kind === "replayed") c.header("Idempotency-Replayed", "true");
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
          dkimVerdictReason: detail.dkimVerdictReason,
          dkimVerifiedDomain: detail.dkimVerifiedDomain,
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
      // What state the link is actually in decides whether there is anything to accept. The UPDATE
      // below is guarded on `staged` and quietly changes nothing otherwise, which was fine while the
      // batch only carried an audit row — it is not fine now that the batch announces a filing, and it
      // was never fine that a second accept wrote an audit row for a promotion that did not happen.
      // Reading first also answers honestly for a link somebody unlinked, which previously returned
      // 200 "filed" over a row still sitting in `unlinked`.
      const links = await readEmailMatterLinksForMessage(
        firm.firmDatabase,
        emailMessageId as EmailMessageId,
      );
      const link = links.find((candidate) => candidate.matterId === matterId);
      if (link === undefined || link.state === "unlinked") {
        return problemJson(c, {
          type: "not-found",
          title: "No staged link",
          status: 404,
          detail: "No staged email link for this message on this matter.",
        });
      }
      // Already filed: the repeat of an accept that landed. Nothing changed, so nothing is written and
      // nobody is told a second time — the response is the same one the first accept returned.
      if (link.state === "filed") {
        return c.json({ emailMessageId, matterId, state: "filed" }, 200);
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
          // The notification's emission point, and it is this row rather than a call: it commits in the
          // same batch as the promotion, so it exists exactly when the filing does. Two identifiers and
          // nothing else — no subject, no address, no participant list.
          outboxMessages: [{ topic: EMAIL_FILED_TOPIC, payload: { emailMessageId, matterId } }],
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
