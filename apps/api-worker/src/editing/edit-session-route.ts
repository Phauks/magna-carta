import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { getActiveExclusiveLock } from "@magna-carta/file-manager/checkout-statements";
import { setFileEditStateStatement } from "@magna-carta/file-manager/file-statements";
import { getFileWithCurrentCleanVersion } from "@magna-carta/file-manager/queries";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FileId, FileVersionId, MatterId } from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import type { Bindings } from "../bindings.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import type { ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";
import { identifierPathParam } from "../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { documentSessionStub } from "./document-session.ts";
import { mintEditToken, type EditCapability } from "./wopi-token.ts";

// How long a minted access token is valid. The editor refreshes within this window; the value is short
// so a leaked token expires quickly.
const TOKEN_WINDOW_MS = 60 * 60 * 1000;

// The internal host coolwsd uses as its WOPISrc. It never resolves on the public internet: the editor
// container intercepts it (DocumentEditorContainer.outboundByHost) and forwards to this worker's WOPI
// surface over the service binding, so coolwsd reaches the document with no egress. MUST match WOPI_HOST
// in the magna-carta-edit worker (apps/edit-worker/src/document-editor-container.ts).
const WOPI_HOST = "wopi.magna-carta.internal";

// The dedicated cookieless content domain — a separate registrable domain from the app, the one home for
// all browser-served untrusted bytes (the editor at `<documentKey>.<domain>`, file previews/downloads at
// `files.<domain>`). It is fixed, owned infrastructure, so the production value is the default and prod
// needs no deploy var; only local dev overrides USERCONTENT_DOMAIN (e.g. to edit.localhost in .dev.vars).
function userContentDomain(env: Bindings): string {
  return env.USERCONTENT_DOMAIN ?? "magnacartausercontent.com";
}

// The opaque, stable per-document key — the first label of the editor origin. Deterministic, so a
// document's co-editors converge on ONE container; opaque, so the public hostname leaks no fileId. The
// magna-carta-edit worker reads this label and keys its container by it. The WOPI access token, not the
// hostname, authorizes — so the key need only be collision-resistant and leak-free, not secret.
//
// The shape produced here — exactly 52 lowercase hex characters — is a contract: the edit worker refuses
// any Host label that does not match it rather than booting a container for it, so changing the length or
// the alphabet means changing DOCUMENT_KEY_PATTERN in apps/edit-worker/src/document-routing.ts in
// the same commit.
async function deriveDocumentKey(fileId: FileId): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fileId));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 52);
}

// Where the caller's current open of a document has got to, as the host saw it. The screen watches
// the editor come up through the frame; this is the half it cannot see — the editor's own calls back
// to this host — so a stalled open can name the call that never came, or the answer it got.
const EditOpenProgressResponse = z
  .object({
    // When this member's launch was answered; null when no launch of this document is on record for
    // them (the session was reaped since, or the open predates the record).
    launchedAt: z.string().nullable(),
    // When the editor asked the host what the document is (CheckFileInfo answered 2xx), or null.
    checkFileInfoAt: z.string().nullable(),
    // When the editor asked the host for the document's bytes (GetFile answered 2xx), or null.
    getFileAt: z.string().nullable(),
    // The most recent call the editor made and what it was told, refusals included, or null.
    lastCallback: z
      .object({
        operation: z.string(),
        status: z.number(),
        errorId: z.string().nullable(),
        at: z.string(),
      })
      .nullable(),
  })
  .openapi("EditOpenProgressResponse");

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
  database: ProxyBatchDatabase,
  fileId: FileId,
): Promise<LaunchTarget | "not-found" | "no-version"> {
  // One round-trip: the file row + its current clean version (this is a user-facing launch path).
  const file = await getFileWithCurrentCleanVersion(database, fileId);
  if (file === undefined || file.deletedAt !== null) return "not-found";
  if (file.currentVersion === null) return "no-version";
  return { matterId: file.matterId, versionId: file.currentVersion.id };
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
  // A fresh open record for this member, whatever the seat: the marks the screen reads while it waits
  // are those of THIS launch and never of the attempt before it.
  await documentSessionStub(c.env, input.fileId).beginOpen(
    input.memberId,
    new Date().toISOString(),
  );
  // The origin of the page that asked for this launch — the firm's own branded subdomain. It is carried
  // in the token because the WOPI callbacks have no request of their own to read it from, and it is read
  // from THIS request rather than configured because per-firm subdomains mean there is no one app origin
  // a deployment could name. CheckFileInfo returns it as PostMessageOrigin, which is what lets the editor
  // tell the screen framing it that the document is up.
  const appOrigin = new URL(c.req.url).origin;
  const accessToken = await mintEditToken(
    {
      firmId: input.firmId,
      matterId: input.target.matterId,
      fileId: input.fileId,
      versionId: input.target.versionId,
      memberId: input.memberId,
      capability: input.capability,
      sessionId: input.sessionId,
      appOrigin,
      exp,
    },
    c.env,
  );
  // The per-document cookieless editor origin (one isolated coolwsd container behind it). coolwsd's
  // WOPISrc points at the internal host — intercepted by the container and forwarded to this worker's
  // /wopi surface, so the editor reaches the document with no egress. Object keys are derived from the
  // signed token, never the URL.
  const documentKey = await deriveDocumentKey(input.fileId);
  const editorOrigin = `https://${documentKey}.${userContentDomain(c.env)}`;
  const wopiSrc = `http://${WOPI_HOST}/wopi/files/${input.fileId}`;
  const editorUrl = `${editorOrigin}/browser/dist/cool.html?WOPISrc=${encodeURIComponent(wopiSrc)}`;
  return {
    editorUrl,
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

// Reads the caller's own open record for a document. Gated exactly like the viewer launch — matter
// access, no edit capability — because it reveals nothing of the document, only the timing of the
// caller's own editor's calls. Polled by the screen while an open is in flight, and only then.
export const editOpenProgressMeta: RouteMeta = {
  operationId: "documents.editOpenProgress",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const editOpenProgressRoute = defineOpenAPIRoute(editOpenProgressMeta, {
  method: "get",
  path: "/api/v1/documents/{fileId}/edit-session/progress",
  request: { params: z.object({ fileId: identifierPathParam("file", "fileId") }) },
  description:
    "Where the caller's current open of this document has got to as the host saw it: when the launch was answered, when the editor asked for the document's information and bytes, and the editor's most recent call and its answer.",
  responses: {
    200: {
      description: "The caller's open record; every mark null when no launch is on record",
      content: { "application/json": { schema: EditOpenProgressResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The file does not exist in this firm",
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
      // context lets the DO's idle alarm free the document if this session later dies. The exclusive-lock
      // HOLDER reaches here too (they may edit their own lock) — they still join to establish the session
      // the WOPI callbacks bind to, but the document stays `checked_out`, never `coediting`.
      const isExclusiveHolder = exclusiveLock !== undefined;
      const { sessionId } = await documentSessionStub(c.env, fileId).joinEditor(memberId, {
        fileId,
        bucketName: firmContext.bucketName,
      });

      // Record the open. The exclusive holder keeps `checked_out` (an exclusive lock is not co-editing);
      // everyone else moves the document to `coediting`.
      const now = new Date().toISOString();
      await commitEffectBatch(
        firmContext.firmDatabase,
        {
          statements: [
            setFileEditStateStatement(
              firmContext.firmDatabase,
              fileId,
              isExclusiveHolder ? "checked_out" : "coediting",
              now,
            ),
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

  app.openapi(
    {
      ...editOpenProgressRoute,
      middleware: chokepointMiddleware(chokepoint, editOpenProgressRoute),
    },
    async (c) => {
      const firmContext = requireChokepointFirmContext(c);
      const memberId = requireChokepointUserId(c);
      const fileId = c.req.param("fileId") as FileId;

      // The same existence check the launches make, so a file outside this firm answers 404 here as
      // it does there, and never a record.
      const file = await getFileWithCurrentCleanVersion(firmContext.firmDatabase, fileId);
      if (file === undefined || file.deletedAt !== null) return launchProblem(c, "not-found");

      const progress = await documentSessionStub(c.env, fileId).openProgressOf(memberId);
      return c.json(
        progress ?? {
          launchedAt: null,
          checkFileInfoAt: null,
          getFileAt: null,
          lastCallback: null,
        },
        200,
      );
    },
  );
}
