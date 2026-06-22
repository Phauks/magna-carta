import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { getCurrentCleanVersion } from "@magna-carta/file-manager/queries";
import { selectFileStatement } from "@magna-carta/file-manager/file-statements";
import type { FileId, MatterId } from "@magna-carta/identifiers/types";
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
import { mintEditToken } from "./wopi-token.ts";

// How long a minted editing access token is valid. The editor refreshes within this window; the value
// is short so a leaked token expires quickly.
const TOKEN_WINDOW_MS = 60 * 60 * 1000;

// The Collabora editor entry URL (urlsrc) is published by the editing container's /hosting/discovery.
// Until that container is deployed, a configured value (or a local default) stands in — wired as a
// seam here so the live discovery fetch slots in without changing the route.
function editorDiscoveryUrlsrc(env: Bindings): string {
  return env.COLLABORA_DISCOVERY_URLSRC ?? "https://collabora.localhost/browser/dist/cool.html";
}

const EditSessionResponse = z
  .object({
    // The full editor URL to load in an iframe: the discovery urlsrc with the host's WOPISrc appended.
    editorUrl: z.string(),
    // The editor's origin, for the SPA document to allow in its frame-src when the editor UI is built.
    editorOrigin: z.string(),
    // The opaque WOPI access token the editor replays on every callback.
    accessToken: z.string(),
    // Absolute epoch-milliseconds expiry of the access token (the WOPI access_token_ttl convention).
    accessTokenTtl: z.number(),
  })
  .openapi("EditSessionResponse");

// Launches an editing session for a file: mints the per-firm WOPI access token and returns the editor
// URL the client iframes. The chokepoint enforces documents:edit; the handler resolves the file from
// the session firm's database (404 when absent) and derives the WOPI host callback URL from the
// request origin. The editor-origin CSP is enforced by the SPA document when the editor UI is built.
export const editSessionMeta: RouteMeta = {
  operationId: "documents.editSession",
  surface: "app",
  authenticated: true,
  permission: "documents:edit",
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const editSessionRoute = defineOpenAPIRoute(editSessionMeta, {
  method: "post",
  path: "/api/v1/documents/{fileId}/edit-session",
  request: { params: z.object({ fileId: identifierPathParam("file", "fileId") }) },
  description:
    "Launch an editing session for a document: returns the editor URL to iframe, the editor origin, and a short-lived WOPI access token.",
  responses: {
    200: {
      description: "The editing session launch payload",
      content: { "application/json": { schema: EditSessionResponse } },
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

      const { results } = await selectFileStatement(firmContext.firmDatabase, fileId).all<{
        matter_id: MatterId;
        deleted_at: string | null;
      }>();
      const fileRow = results[0];
      if (fileRow === undefined || fileRow.deleted_at !== null) {
        return problemJson(c, {
          type: "not-found",
          status: 404,
          title: "Not found",
          detail: "No such document.",
        });
      }
      const cleanVersion = await getCurrentCleanVersion(firmContext.firmDatabase, fileId);
      if (cleanVersion === undefined) {
        return problemJson(c, {
          type: "not-found",
          status: 404,
          title: "Not found",
          detail: "The document has no committed version to open.",
        });
      }

      const exp = Date.now() + TOKEN_WINDOW_MS;
      const accessToken = await mintEditToken(
        {
          firmId,
          matterId: fileRow.matter_id,
          fileId,
          versionId: cleanVersion.id,
          memberId,
          capability: "edit",
          sessionId: crypto.randomUUID(),
          exp,
        },
        c.env,
      );

      const urlsrc = editorDiscoveryUrlsrc(c.env);
      const editorOrigin = new URL(urlsrc).origin;
      const wopiSrc = `${new URL(c.req.url).origin}/wopi/files/${fileId}`;
      const separator = urlsrc.includes("?") ? "&" : "?";
      const editorUrl = `${urlsrc}${separator}WOPISrc=${encodeURIComponent(wopiSrc)}`;

      return c.json({ editorUrl, editorOrigin, accessToken, accessTokenTtl: exp }, 200);
    },
  );
}
