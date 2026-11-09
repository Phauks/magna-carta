/*
 * Live browsing: one held remote browser per member, streamed to their screen and driven by their
 * pointer and keyboard.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE CAPTURE: the member uses the page. They click through a consent
 * wall, scroll to the part a page hides below the fold, type into a search box — in a browser that
 * remembers each step, so a link built to reveal itself only in stages can be followed through them.
 *
 * WHAT IS IDENTICAL TO THE CAPTURE, and must stay that way: what reaches the member's browser is
 * pictures and text. The stream carries JPEG frames of the remote screen and the inspector's facts;
 * no markup, no script. Input travels the other way as data — a position, a key name, pasted text —
 * and the page's code only ever runs on the remote machine.
 *
 * THE GUARD IS THE POINT. `assertPublicTarget` runs on every address the member enters, and on every
 * document the remote browser requests for the whole session: each redirect, each link clicked,
 * each navigation the page starts itself. The per-hop half lives in the browser adapter
 * (`safe-browse/puppeteer-live-browser.ts`), where the requests are.
 *
 * The routes here are thin. The stream is the session object's: this module checks who is asking
 * and from where, then hands the upgrade to the member's own object.
 */
import { type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmId,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { isSameOriginUpgrade } from "../../chokepoint/same-origin-upgrade.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { isWebSocketUpgrade } from "../../../progress/job-progress-sockets.ts";
import { streamRequest, type SafeBrowseSession } from "../../../safe-browse/safe-browse-session.ts";

const liveStreamMeta: RouteMeta = {
  operationId: "safeBrowse.liveStream",
  surface: "app",
  authenticated: true,
  permission: "tools:safeBrowse",
  resource: "firm",
  // Audited: a stream holds a browser the firm is paying for while a member drives it, and who did
  // that is worth a row. The audit records the act, never an address.
  audited: true,
  idempotency: "optional",
  // `expensive`: opening a stream can acquire a real browser, and the account's acquisition budget
  // is small and shared across every member. Reconnecting to a held one acquires nothing.
  rateLimit: "expensive",
};

// The screen size the member's page has, so the first frames arrive the right shape. Bounded here
// and clamped again by the stream; nothing else from the request travels inward.
const LiveStreamQuery = z.object({
  width: z.coerce.number().int().min(1).max(8000).optional(),
  height: z.coerce.number().int().min(1).max(8000).optional(),
});

const liveStreamRoute = defineOpenAPIRoute(liveStreamMeta, {
  method: "get",
  path: "/api/v1/safe-browse/live/stream",
  description:
    "Opens the member's live browsing stream over a WebSocket. The server sends a ready frame once " +
    "a remote browser is theirs (reconnecting to the one they hold, or launching one), then JPEG " +
    "frames of its screen, its location, and the inspector's facts after each page load. The client " +
    "sends pointer, wheel, key and pasted-text input, navigations, and an acknowledgement per frame " +
    "drawn. Every document the remote browser requests passes the public-address guard; no markup " +
    "or script reaches the member's browser. One stream per member: a second one takes the browser " +
    "over. Requires an Upgrade: websocket request from this application's own origin.",
  request: { query: LiveStreamQuery },
  responses: {
    101: { description: "The stream is open; frames follow" },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description:
        "Authenticated, but the member lacks tools:safeBrowse, or the upgrade came from another site",
      content: { "application/problem+json": { schema: Problem } },
    },
    426: {
      description: "The request did not ask to upgrade to a WebSocket",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const liveCloseMeta: RouteMeta = {
  operationId: "safeBrowse.liveClose",
  surface: "app",
  authenticated: true,
  permission: "tools:safeBrowse",
  resource: "firm",
  // Audited on the same terms as the stream: ending a session closes a browser the firm was paying
  // to hold, which is a real act on a real resource rather than housekeeping. The
  // non-mutating-POST allow-list is for posts that change nothing, and this changes something.
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

const liveCloseRoute = defineOpenAPIRoute(liveCloseMeta, {
  method: "post",
  path: "/api/v1/safe-browse/live/close",
  description:
    "End the member's live browsing session: end any open stream and close the remote browser. " +
    "Idempotent: closing a session that has already ended is success, because the service reaps " +
    "idle sessions itself.",
  request: {},
  responses: {
    204: { description: "The session is ended" },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Authenticated, but the member lacks tools:safeBrowse",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

// Firm-namespaced, so a session can never be addressed from another firm by a caller who knows a
// user id. Both halves come from the chokepoint's resolved session, never from the request.
function sessionFor(
  env: Bindings,
  firmId: string,
  userId: string,
): DurableObjectStub<SafeBrowseSession> {
  const namespace = env.SAFE_BROWSE_SESSION as DurableObjectNamespace<SafeBrowseSession>;
  return namespace.get(namespace.idFromName(`${firmId}:${userId}`));
}

export function registerSafeBrowseLiveRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...liveStreamRoute, middleware: chokepointMiddleware(chokepoint, liveStreamRoute) },
    async (c) => {
      if (!isWebSocketUpgrade(c.req.raw)) {
        return problemJson(c, {
          type: "websocket-upgrade-required",
          status: 426,
          title: "WebSocket upgrade required",
          detail: "This endpoint serves the live browsing stream. Send Upgrade: websocket.",
        });
      }
      // Asked before any browser is touched: a foreign page holding the member's cookie could
      // otherwise open this socket, watch their screen and type into it.
      if (!isSameOriginUpgrade(c.req.raw, c.env.APP_BASE_URL)) {
        return problemJson(c, {
          type: "permission-denied",
          status: 403,
          title: "Cross-origin streaming is refused",
          detail: "Open the Safe Website Viewer from this application.",
        });
      }
      const { width, height } = c.req.valid("query");
      const stub = sessionFor(
        c.env,
        requireChokepointFirmId(c),
        requireChokepointUserId(c) as unknown as string,
      );
      // The request inward is built from scratch — nothing the caller sent travels on to the
      // object except the two numbers validated above.
      return stub.fetch(
        streamRequest(width !== undefined && height !== undefined ? { width, height } : null),
      );
    },
  );

  app.openapi(
    { ...liveCloseRoute, middleware: chokepointMiddleware(chokepoint, liveCloseRoute) },
    async (c) => {
      await sessionFor(
        c.env,
        requireChokepointFirmId(c),
        requireChokepointUserId(c) as unknown as string,
      ).end();
      return c.body(null, 204) as never;
    },
  );
}
