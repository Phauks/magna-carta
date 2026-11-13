import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import {
  decidePlayableCopyRequest,
  markVersionPlayableCopyPendingStatement,
  type PlayableCopyRequestDecision,
  readCurrentVersionForPlayableCopy,
  type VersionForPlayableCopy,
} from "@magna-carta/file-manager/playable-copy";
import type { Bindings } from "../../../bindings.ts";
import type { PlayableCopyMessage } from "../../../conversions/conversion-types.ts";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
import { mintPreviewDeliveryToken } from "../../../files/preview-token.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { identifierPathParam } from "../../contracts/common.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

// A copy of a video that every browser plays: asked for, and looked up.
//
// The preview gate promises only that SOME browser decodes a recording, and the player is the last
// word for the browser in front of the member. When that browser refuses the original (or the
// server already judged it download-only), the player offers to prepare a copy: POST asks for it,
// GET says where it stands, and a ready copy carries a short-lived signed address on the cookieless
// files host, minted exactly as the preview route mints one for an original. The rules for the copy
// itself are packages/file-manager/src/playable-copy.ts; the work is done off the request path by
// background/conversions/playable-copy-consumer.ts.
//
// A request is accepted whatever the version's playability verdict, `playable` included: a verdict
// is about browsers in general, and the browser that just refused the file is the one that matters.
// Looking a copy up has the preview route's read posture: any member who can reach the file may
// watch it. Asking for one starts work the firm pays for in engine time, so it takes the capability
// the member's own "scan this file again" takes, files:upload, the same posture for the same kind
// of request.

const PLAYABLE_COPY_STREAM_TTL_SECONDS = 300;

const fileParam = z.object({ id: identifierPathParam("file", "id") });

const PlayableCopyStatus = z
  .object({
    versionId: z.string(),
    // none: nobody has asked. pending: being made. ready: made, with streamUrl when the files host is
    // bound. unavailable: cannot be made, with the reason.
    state: z.enum(["none", "pending", "ready", "unavailable"]),
    reason: z.enum(["unsupported", "malformed", "too-large", "source-missing"]).nullable(),
    streamUrl: z.string().nullable(),
    contentType: z.literal("video/mp4"),
    sizeBytes: z.number().int().nullable(),
  })
  .openapi("PlayableCopyStatus");

const errors = {
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The file is unknown, deleted, or has no clean current version",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const statusMeta: RouteMeta = {
  operationId: "files.playableCopy",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const statusRoute = defineOpenAPIRoute(statusMeta, {
  method: "get",
  path: "/api/v1/files/{id}/playable-copy",
  description:
    "Reports the playable copy of the file's current clean version: a copy converted to H.264 " +
    "and AAC in an MP4 so every browser plays it. A ready copy carries a short-lived signed " +
    "streamUrl on the cookieless files host (null when that host is not bound). 404 when the file " +
    "has no clean current version.",
  request: { params: fileParam },
  responses: {
    200: {
      description: "Where the copy stands",
      content: { "application/json": { schema: PlayableCopyStatus } },
    },
    401: errors[401],
    404: errors[404],
    429: errors[429],
  },
});

const requestMeta: RouteMeta = {
  operationId: "files.requestPlayableCopy",
  surface: "app",
  authenticated: true,
  permission: "files:upload",
  resource: "matter",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

const requestRoute = defineOpenAPIRoute(requestMeta, {
  method: "post",
  path: "/api/v1/files/{id}/playable-copy",
  description:
    "Asks for a playable copy of the file's current clean version, converted in the background. " +
    "Answers 202 with state pending while it is made, 200 when it already exists or cannot be " +
    "made (state unavailable, with the reason). Asking again while a copy is being made does not " +
    "start a second conversion. Accepted whatever the version's playability verdict, since the " +
    "browser that refused the original is the one that matters. 422 when the version is not a " +
    "video the converter reads (MP4, QuickTime or Matroska), or a scan flagged it.",
  request: { params: fileParam },
  responses: {
    200: {
      description: "The copy exists, or cannot be made",
      content: { "application/json": { schema: PlayableCopyStatus } },
    },
    202: {
      description: "The copy is being made",
      content: { "application/json": { schema: PlayableCopyStatus } },
    },
    401: errors[401],
    404: errors[404],
    429: errors[429],
    403: {
      description: "The session member lacks files:upload",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description: "The version is not a video the converter reads, or a scan flagged it",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

type Status = z.infer<typeof PlayableCopyStatus>;

async function statusOf(
  env: Bindings,
  bucketName: string,
  version: VersionForPlayableCopy,
): Promise<Status> {
  const base = {
    versionId: version.id,
    contentType: "video/mp4" as const,
    reason: null,
    streamUrl: null,
    sizeBytes: null,
  };
  if (version.playableCopyState === null) return { ...base, state: "none" };
  if (version.playableCopyState === "pending") return { ...base, state: "pending" };
  if (version.playableCopyState === "unavailable") {
    return { ...base, state: "unavailable", reason: version.playableCopyReason ?? "unsupported" };
  }
  const r2Key = version.playableCopyR2Key;
  const filesOrigin = env.FILES_ORIGIN;
  // A flagged version's copy is not handed out either: the same gate keeps the original out of the
  // player (packages/file-manager/src/preview-policy.ts).
  const streamable =
    r2Key !== null && filesOrigin !== undefined && version.scanVerdict !== "flagged";
  const streamUrl = streamable
    ? `https://${filesOrigin}/api/files-preview/${await mintPreviewDeliveryToken(env.AUTH_SECRET, {
        r2Key,
        bucket: bucketName,
        sniffedContentType: "video/mp4",
        // The copy is H.264 and AAC in a faststart MP4 by construction: the engine writes nothing
        // else, which is the whole reason the copy exists.
        verdict: "playable",
        exp: Math.floor(Date.now() / 1000) + PLAYABLE_COPY_STREAM_TTL_SECONDS,
      })}`
    : null;
  return { ...base, state: "ready", streamUrl, sizeBytes: version.playableCopySizeBytes };
}

const NOT_FOUND = {
  type: "not-found",
  title: "Not found",
  status: 404,
  detail: "No such file with a clean current version in this firm.",
} as const;

function refusalDetail(
  decision: Extract<PlayableCopyRequestDecision, { kind: "not-a-candidate" }>,
): string {
  if (decision.why === "flagged") {
    return "A scan flagged this version, so it is not converted for playback.";
  }
  if (decision.why === "encoded") {
    return "This version is stored in a form the converter cannot read directly.";
  }
  return "Only MP4, QuickTime and Matroska videos can be converted for playback.";
}

export function registerPlayableCopyRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // GET /api/v1/files/{id}/playable-copy — where the copy stands
  app.openapi(
    { ...statusRoute, middleware: chokepointMiddleware(chokepoint, statusRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { id } = c.req.valid("param");
      const version = await readCurrentVersionForPlayableCopy(firm.firmDatabase, id);
      if (version === undefined) return problemJson(c, NOT_FOUND);
      const bucketName = resolveFirmBucket(c.env, firm.bucketName).bucketName;
      return c.json(await statusOf(c.env, bucketName, version), 200, {
        "Cache-Control": "private, no-store",
      });
    },
  );

  // POST /api/v1/files/{id}/playable-copy — ask for the copy
  app.openapi(
    { ...requestRoute, middleware: chokepointMiddleware(chokepoint, requestRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      const { id } = c.req.valid("param");
      const version = await readCurrentVersionForPlayableCopy(firm.firmDatabase, id);
      if (version === undefined) return problemJson(c, NOT_FOUND);
      const bucketName = resolveFirmBucket(c.env, firm.bucketName).bucketName;
      const now = new Date();
      const decision = decidePlayableCopyRequest(version, now.getTime());
      if (decision.kind === "not-a-candidate") {
        return problemJson(c, {
          type: "playable-copy-not-a-candidate",
          title: "No playable copy can be made of this file",
          status: 422,
          detail: refusalDetail(decision),
        });
      }
      if (decision.kind === "start") {
        const requestedAt = now.toISOString();
        await commitEffectBatch(
          firm.firmDatabase,
          {
            statements: [
              markVersionPlayableCopyPendingStatement(firm.firmDatabase, version.id, requestedAt),
              // Only a request that starts work is recorded: it is the one that spends engine time.
              insertAuditLogStatement(firm.firmDatabase, {
                id: newIdentifier("auditLog"),
                event: "file.playable_copy_requested",
                actorUserId: userId,
                subjectId: version.id,
                metadata: { sourceFormat: decision.sourceFormat },
                now: requestedAt,
              }),
            ],
            outboxMessages: [],
          },
          { now: () => requestedAt },
        );
        const message: PlayableCopyMessage = {
          kind: "playable-copy",
          firmId,
          bucketName,
          versionId: version.id,
        };
        await c.env.CONVERSION.send(message);
        const pending: VersionForPlayableCopy = {
          ...version,
          playableCopyState: "pending",
          playableCopyRequestedAt: requestedAt,
        };
        return c.json(await statusOf(c.env, bucketName, pending), 202, {
          "Cache-Control": "private, no-store",
        });
      }
      const status = await statusOf(c.env, bucketName, version);
      return c.json(status, decision.kind === "in-progress" ? 202 : 200, {
        "Cache-Control": "private, no-store",
      });
    },
  );
}
