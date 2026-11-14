import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { ProviderNotice } from "@magna-carta/calendar/sync-port";
import { readGoogleNotices } from "@magna-carta/google-calendar/change-notices";
import { readGraphNotices } from "@magna-carta/microsoft-graph/change-notices";
import type { Bindings } from "../../../bindings.ts";
import { GOOGLE_NOTICE_PATH, MICROSOFT_NOTICE_PATH } from "../../../calendar-sync/change-watch.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

// WHERE A CALENDAR PROVIDER SAYS "SOMETHING CHANGED".
//
// The caller is the provider's own service, which holds no session, so the route is public. What
// it can do is correspondingly small: it asks one account's object to consider the notice, and the
// object acts only when the notice carries the secret that object gave the provider. A request
// from anybody else is answered exactly as a real one is and changes nothing.
//
// Nothing about the change is read here or anywhere: a believed notice only brings the account's
// ordinary pass forward, and that pass reads the account itself.
//
// One route per provider, because each provider's notice is a different shape. The reader that
// turns a body into notices belongs to the provider's package.

// A notice names a subscription and a secret; a batch of them is small. Anything larger is not one.
const BODY_LIMIT_BYTES = 256 * 1024;
// The provider proves an address is listening by sending a token to be sent back. It is opaque
// and has no stated size; this is far past any it has sent and far short of a body worth abusing.
const VALIDATION_TOKEN_LIMIT = 4096;

const microsoftNoticeMeta: RouteMeta = {
  operationId: "calendarSync.receiveMicrosoftNotice",
  // Public by necessity: the provider's notification service has no session to present.
  surface: "public",
  authenticated: false,
  permission: null,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "provider-notice",
};

const noticeParams = z.object({
  firmId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  connectionId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
});

const microsoftNoticeRoute = defineOpenAPIRoute(microsoftNoticeMeta, {
  method: "post",
  path: `${MICROSOFT_NOTICE_PATH}/{firmId}/{connectionId}`,
  description:
    "Receives Microsoft's notice that something in a member's connected calendar changed. Called " +
    "by Microsoft and by nothing in this platform. A notice is acted on only when it carries the " +
    "secret that account gave Microsoft, and every request is answered alike whether or not it " +
    "was believed. With a `validationToken` query parameter the token is answered back as plain " +
    "text, which is how Microsoft confirms the address before it begins sending.",
  request: {
    params: noticeParams,
    query: z.object({ validationToken: z.string().max(VALIDATION_TOKEN_LIMIT).optional() }),
  },
  responses: {
    200: {
      description: "The validation token, answered back as it was sent",
      content: { "text/plain": { schema: z.string() } },
    },
    202: { description: "The notice was received" },
    422: {
      description: "The address or the validation token is not one this route could have issued",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const googleNoticeMeta: RouteMeta = {
  operationId: "calendarSync.receiveGoogleNotice",
  // Public for the same reason: Google's notification service has no session to present.
  surface: "public",
  authenticated: false,
  permission: null,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "provider-notice",
};

const googleNoticeRoute = defineOpenAPIRoute(googleNoticeMeta, {
  method: "post",
  path: `${GOOGLE_NOTICE_PATH}/{firmId}/{connectionId}`,
  description:
    "Receives Google's notice that something in a member's connected calendar changed. Called " +
    "by Google and by nothing in this platform. The notice has no body: it is acted on only " +
    "when its `X-Goog-Channel-Token` header carries the secret that account gave Google, and " +
    "every request is answered alike whether or not it was believed.",
  request: { params: noticeParams },
  responses: {
    202: { description: "The notice was received" },
    422: {
      description: "The address is not one this route could have issued",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

async function readBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > BODY_LIMIT_BYTES) return undefined;
  const text = await request.text();
  if (text.length > BODY_LIMIT_BYTES) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function registerProviderNoticeRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...microsoftNoticeRoute, middleware: chokepointMiddleware(chokepoint, microsoftNoticeRoute) },
    async (c) => {
      const { validationToken } = c.req.valid("query");
      if (validationToken !== undefined) {
        // Plain text and marked as nothing else, so a token shaped like markup is never rendered.
        return c.text(validationToken, 200, { "X-Content-Type-Options": "nosniff" });
      }
      const { firmId, connectionId } = c.req.valid("param");
      await hand(c.env, firmId, connectionId, readGraphNotices(await readBody(c.req.raw)));
      return c.body(null, 202);
    },
  );

  app.openapi(
    { ...googleNoticeRoute, middleware: chokepointMiddleware(chokepoint, googleNoticeRoute) },
    async (c) => {
      const { firmId, connectionId } = c.req.valid("param");
      await hand(c.env, firmId, connectionId, readGoogleNotices(c.req.raw.headers));
      return c.body(null, 202);
    },
  );
}

// Hands a request's notices to the one account's object they are addressed to. The object, and
// nothing here, decides whether to believe them.
async function hand(
  env: Bindings,
  firmId: string,
  connectionId: string,
  notices: readonly ProviderNotice[],
): Promise<void> {
  if (notices.length === 0) return;
  await env.CONNECTION_SYNC.get(
    env.CONNECTION_SYNC.idFromName(`${firmId}:${connectionId}`),
  ).providerNotice(notices);
}
