import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { getActiveExclusiveLock } from "@magna-carta/file-manager/checkout-statements";
import {
  selectFileStatement,
  setFileEditStateStatement,
} from "@magna-carta/file-manager/file-statements";
import { getCurrentCleanVersion } from "@magna-carta/file-manager/queries";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FileId, FileVersionId, MatterId } from "@magna-carta/identifiers/types";
import type { Context } from "hono";
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
import { Problem, problemJson, type ProblemResponse } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { documentSessionStub } from "./document-session.ts";
import { mintEditToken, type EditCapability } from "./wopi-token.ts";

// How long a minted access token is valid. The editor refreshes within this window; the value is short
// so a leaked token expires quickly.
const TOKEN_WINDOW_MS = 60 * 60 * 1000;

// The Collabora editor entry URL (urlsrc) is published by the editing container's /hosting/discovery.
// Until that container is deployed, a configured value (or a local default) stands in — wired as a
// seam here so the live discovery fetch slots in without changing the route.
function editorDiscoveryUrlsrc(env: Bindings): string {
  return env.COLLABORA_DISCOVERY_URLSRC ?? "https://collabora.localhost/browser/dist/cool.html";
}

const SessionLaunchResponse = z
  .object({
    // The full editor URL to load in an iframe: the discovery urlsrc with the host's WOPISrc appended.
    editorUrl: z.string(),
    // The editor's origin, for the SPA document to allow in its frame-src when the editor UI is built.
    editorOrigin: z.string(),
    // The opaque WOPI access token the editor replays on every callback.
    accessToken: z.string(),
    // Absolute epoch-milliseconds expiry of the access token (the WOPI access_token_ttl convention).
    accessTokenTtl: z.number(),
    // The capability granted: 'edit' for an editing session, or 'view' — including when an edit launch
    // is forced read-only because another member holds an exclusive lock. The viewer is never blocked.
    capability: z.enum(["edit", "view"]),
  })
  .openapi("SessionLaunchResponse");

type LaunchTarget = { readonly matterId: MatterId; readonly versionId: FileVersionId };

// Resolves the file to open: its matter (for the token's tenancy claim) and its current committed
// version. "not-found" when the file is absent/deleted in this firm; "no-version" when nothing has
// committed yet (nothing to open).
async function resolveLaunchTarget(
  database: D1Database,
  fileId: FileId,
): Promise<LaunchTarget | "not-found" | "no-version"> {
  const { results } = await selectFileStatement(database, fileId).all<{
    matter_id: MatterId;
    deleted_at: string | null;
  }>();
  const fileRow = results[0];
  if (fileRow === undefined || fileRow.deleted_at !== null) return "not-found";
  const cleanVersion = await getCurrentCleanVersion(database, fileId);
  if (cleanVersion === undefined) return "no-version";
  return { matterId: fileRow.matter_id, versionId: cleanVersion.id };
}

function launchProblem(c: Context, reason: "not-found" | "no-version"): ProblemResponse<404> {
  return problemJson(c, {
    type: "not-found",
    status: 404,
    title: "Not found",
    detail:
      reason === "not-found"
        ? "No such document."
        : "The document has no committed version to open.",
  });
}

// Assembles the WOPI access token + the editor iframe URL for a launch. The WOPISrc points back at this
// host's WOPI callback surface for the file; every object key the editor reaches is derived from the
// signed token, never the URL.
async function buildLaunch(
  c: Context,
  input: {
    firmId: string;
    target: LaunchTarget;
    fileId: FileId;
    memberId: string;
    capability: EditCapability;
    sessionId: string;
  },
): Promise<z.infer<typeof SessionLaunchResponse>> {
  const exp = Date.now() + TOKEN_WINDOW_MS;
  const accessToken = await mintEditToken(
    {
      firmId: input.firmId,
      matterId: input.target.matterId,
      fileId: input.fileId,
      versionId: input.target.versionId,
      memberId: input.memberId,
      capability: input.capability,
      sessionId: input.sessionId,
      exp,
    },
    c.env,
  );
  const urlsrc = editorDiscoveryUrlsrc(c.env);
  const editorOrigin = new URL(urlsrc).origin;
  const wopiSrc = `${new URL(c.req.url).origin}/wopi/files/${input.fileId}`;
  const separator = urlsrc.includes("?") ? "&" : "?";
  return {
    editorUrl: `${urlsrc}${separator}WOPISrc=${encodeURIComponent(wopiSrc)}`,
    editorOrigin,
    accessToken,
    accessTokenTtl: exp,
    capability: input.capability,
  };
}

// Launches an EDITING session for a file: joins the shared session on the coordinator DO (so a second
// editor reuses the live session + lock rather than starting a competing one), flips the file to
// 'coediting', and mints an edit-capability WOPI token. Audited — opening an editing session is a
// recorded action. The chokepoint enforces documents:edit; the editor-origin CSP is applied by the SPA
// document when the editor UI is built.
export const editSessionMeta: RouteMeta = {
  operationId: "documents.editSession",
  surface: "app",
  authenticated: true,
  permission: "documents:edit",
  resource: "matter",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

export const editSessionRoute = defineOpenAPIRoute(editSessionMeta, {
  method: "post",
  path: "/api/v1/documents/{fileId}/edit-session",
  request: { params: z.object({ fileId: identifierPathParam("file", "fileId") }) },
  description:
    "Launch an editing session for a document: joins the live co-editing session (or starts one), returns the editor URL to iframe, the editor origin, and a short-lived WOPI edit token.",
  responses: {
    200: {
      description: "The editing session launch payload",
      content: { "application/json": { schema: SessionLaunchResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Authenticated, but the member lacks documents:edit",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The file does not exist in this firm, or has no committed version to open",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

// Launches a READ-ONLY viewer onto a document: joins the live editing session read-only (or opens the
// committed version when none is live), so a member with file access — but not documents:edit — can
// watch the document, including co-editors' live changes, without ever taking the lock or being
// blocked. A GET that writes nothing; gated like the file-read surface (matter-scoped, no edit
// capability), so it inherits the same matter access the preview/download routes enforce.
export const viewSessionMeta: RouteMeta = {
  operationId: "documents.viewSession",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const viewSessionRoute = defineOpenAPIRoute(viewSessionMeta, {
  method: "get",
  path: "/api/v1/documents/{fileId}/view-session",
  request: { params: z.object({ fileId: identifierPathParam("file", "fileId") }) },
  description:
    "Open a read-only viewer for a document: returns the editor URL to iframe and a short-lived view-only WOPI token. Never takes the lock; reading is never blocked.",
  responses: {
    200: {
      description: "The viewer launch payload",
      content: { "application/json": { schema: SessionLaunchResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The file does not exist in this firm, or has no committed version to open",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerDocumentEditingRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...editSessionRoute, middleware: chokepointMiddleware(chokepoint, editSessionRoute) },
    async (c) => {
      const firmContext = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const memberId = requireChokepointUserId(c);
      const fileId = c.req.param("fileId") as FileId;

      const target = await resolveLaunchTarget(firmContext.firmDatabase, fileId);
      if (target === "not-found" || target === "no-version") return launchProblem(c, target);

      // An exclusive lock held by ANOTHER member forces this launch read-only (the holder still edits;
      // everyone else can watch but not take the lock). An offline working copy never blocks editing.
      const exclusiveLock = await getActiveExclusiveLock(firmContext.firmDatabase, fileId);
      if (exclusiveLock !== undefined && exclusiveLock.holderMemberId !== memberId) {
        // Read-only: do not join the editing session, flip edit_state, or audit an edit-open — the
        // launch is a viewer onto the locked document (join the live session id read-only if present).
        const sessionId =
          (await documentSessionStub(c.env, fileId).getState()).sessionId ?? crypto.randomUUID();
        const viewLaunch = await buildLaunch(c, {
          firmId,
          target,
          fileId,
          memberId,
          capability: "view",
          sessionId,
        });
        return c.json(viewLaunch, 200);
      }

      // Join the shared session (minting it on the first editor, reusing it for co-editors). The reap
      // context lets the DO's idle alarm free the document if this session later dies.
      const { sessionId } = await documentSessionStub(c.env, fileId).joinEditor(memberId, {
        fileId,
        bucketName: firmContext.bucketName,
      });

      // Flip the file to co-editing and record the open in the same atomic batch.
      const now = new Date().toISOString();
      await commitEffectBatch(
        firmContext.firmDatabase,
        {
          statements: [
            setFileEditStateStatement(firmContext.firmDatabase, fileId, "coediting", now),
            insertAuditLogStatement(firmContext.firmDatabase, {
              id: newIdentifier("auditLog"),
              event: "document.edit_session_opened",
              actorUserId: memberId,
              subjectId: fileId,
              metadata: null,
              now,
            }),
          ],
          outboxMessages: [],
        },
        { now: () => now },
      );

      const launch = await buildLaunch(c, {
        firmId,
        target,
        fileId,
        memberId,
        capability: "edit",
        sessionId,
      });
      return c.json(launch, 200);
    },
  );

  app.openapi(
    { ...viewSessionRoute, middleware: chokepointMiddleware(chokepoint, viewSessionRoute) },
    async (c) => {
      const firmContext = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const memberId = requireChokepointUserId(c);
      const fileId = c.req.param("fileId") as FileId;

      const target = await resolveLaunchTarget(firmContext.firmDatabase, fileId);
      if (target === "not-found" || target === "no-version") return launchProblem(c, target);

      // Read the live session id to join it read-only when one exists; otherwise a fresh view-only id
      // (the viewer never opens or mutates a session — no DO write, no lock).
      const sessionId =
        (await documentSessionStub(c.env, fileId).getState()).sessionId ?? crypto.randomUUID();

      const launch = await buildLaunch(c, {
        firmId,
        target,
        fileId,
        memberId,
        capability: "view",
        sessionId,
      });
      return c.json(launch, 200);
    },
  );
}
