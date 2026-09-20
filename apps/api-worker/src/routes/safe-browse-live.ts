/*
 * Live browsing: one held browser per member, walked from page to page.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE CAPTURE, and the whole reason it exists: the browser
 * remembers. A shortener into a consent wall into a credential form only reaches its third step
 * because the first two set cookies, and a fresh browser per capture arrives at step one every
 * time. A held session walks the chain.
 *
 * WHAT IS IDENTICAL TO THE CAPTURE, and must stay that way: what crosses back. A base64 screenshot
 * and structured text, never HTML, never live markup. The member's browser gains nothing new to
 * execute, so the property ADR-0119 called the strongest safety argument survives the feature.
 *
 * THE GUARD IS THE POINT. `assertPublicTarget` runs on EVERY navigation, not only the address a
 * member types. A held session differs from a one-shot capture precisely in that a hostile page has
 * a whole session in which to send the browser somewhere it should not go, and the guard lives
 * inside the navigate path so no caller can forget it.
 */
import puppeteer from "@cloudflare/puppeteer";
import type { Browser, BrowserWorker } from "@cloudflare/puppeteer";
import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { SsrfRejection, assertPublicTarget } from "@magna-carta/integrations/safe-target";
import { planLiveSession, sessionContinued, type LiveSessionPlan } from "@magna-carta/safe-browse";
import { RendererFailure } from "@magna-carta/safe-browse";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmId,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import type { SafeBrowseSession } from "../safe-browse/safe-browse-session.ts";

// The service's keep-alive for a held browser. Sits under its ten-minute ceiling; the object's own
// idle alarm is shorter still and is what actually retires a session.
const KEEP_ALIVE_MILLISECONDS = 5 * 60 * 1000;

const LiveNavigateRequest = z.object({ url: z.string().min(1).max(2048) });

const LiveView = z
  .object({
    finalUrl: z.string(),
    screenshotBase64: z.string(),
    title: z.string().optional(),
    links: z.array(z.string()),
    // Whether this navigation continued the member's session or started a new browser. The screen
    // says so: a member walking a consent flow needs to know when the cookies behind them were
    // dropped, because the next page's behaviour changes and nothing else would explain it.
    sessionContinued: z.boolean(),
  })
  .openapi("SafeBrowseLiveView");

const liveNavigateMeta: RouteMeta = {
  operationId: "safeBrowse.liveNavigate",
  surface: "app",
  authenticated: true,
  permission: "tools:safeBrowse",
  resource: "firm",
  // Audited, unlike the capture. A capture is one look at one address; a live session is a member
  // walking a chain of them on a browser the firm is paying to hold, and who did that is worth a
  // row. The audit records the act, never the address.
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

const liveNavigateRoute = defineOpenAPIRoute(liveNavigateMeta, {
  method: "post",
  path: "/api/v1/safe-browse/live/navigate",
  description:
    "Navigate the member's held remote browser to a URL and return an inert view of where it " +
    "landed — screenshot, title, links. The browser is reused across calls so cookies and page " +
    "state survive between steps. No code from the page runs in the member's browser.",
  request: {
    body: { content: { "application/json": { schema: LiveNavigateRequest } }, required: true },
  },
  responses: {
    200: {
      description: "Where the browser landed",
      content: { "application/json": { schema: LiveView } },
    },
    400: {
      description: "The target URL resolves to a non-public address (SSRF guard rejected it)",
      content: { "application/problem+json": { schema: Problem } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Authenticated, but the member lacks tools:safeBrowse",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description: "The page did not finish rendering (type page-render-failed)",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
    502: {
      description: "The remote browser is unavailable or at capacity",
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
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const liveCloseRoute = defineOpenAPIRoute(liveCloseMeta, {
  method: "post",
  path: "/api/v1/safe-browse/live/close",
  description:
    "End the member's live browsing session and close the remote browser. Idempotent: closing a " +
    "session that has already ended is success, because the service reaps idle sessions itself.",
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

/** Acquire the browser this navigation should use, per the plan, and say which it was. */
async function browserForPlan(
  binding: BrowserWorker,
  plan: LiveSessionPlan,
): Promise<{ browser: Browser; plan: LiveSessionPlan }> {
  if (plan.kind === "connect") {
    try {
      return { browser: await puppeteer.connect(binding, plan.sessionId), plan };
    } catch {
      // A recorded id the service has already reaped. Not a fault, and not the member's problem:
      // re-plan as a launch rather than failing the navigation they asked for.
      const relaunch = planLiveSession(null, Date.now(), true);
      return {
        browser: await puppeteer.launch(binding, { keep_alive: KEEP_ALIVE_MILLISECONDS }),
        plan: relaunch,
      };
    }
  }
  return {
    browser: await puppeteer.launch(binding, { keep_alive: KEEP_ALIVE_MILLISECONDS }),
    plan,
  };
}

export function registerSafeBrowseLiveRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...liveNavigateRoute, middleware: chokepointMiddleware(chokepoint, liveNavigateRoute) },
    async (c) => {
      const { url } = c.req.valid("json");

      // EVERY navigation, before anything outbound. The member's typed address and the page's own
      // redirect target are the same class of input here, and this is the only place that holds.
      let target: Awaited<ReturnType<typeof assertPublicTarget>>;
      try {
        target = await assertPublicTarget(url);
      } catch (error) {
        if (error instanceof SsrfRejection) {
          // Never echo the address or any resolved host — the same redaction the capture answers
          // with, for the same reason.
          return problemJson(c, {
            type: "validation",
            status: 400,
            title: "The target URL is not a valid public address",
            detail: "The supplied URL did not resolve to a publicly routable address.",
          });
        }
        throw error;
      }

      const stub = sessionFor(
        c.env,
        requireChokepointFirmId(c),
        requireChokepointUserId(c) as unknown as string,
      );
      const record = await stub.read();
      const planned = planLiveSession(record, Date.now());

      let browser: Browser | null = null;
      try {
        const acquired = await browserForPlan(c.env.BROWSER as BrowserWorker, planned);
        browser = acquired.browser;

        const pages = await browser.pages();
        const page = pages[0] ?? (await browser.newPage());
        await page.goto(target.url.href, { waitUntil: "load", timeout: 30_000 });

        const [screenshot, title, links] = await Promise.all([
          page.screenshot({ encoding: "base64" }) as Promise<string>,
          page.title().catch(() => undefined),
          page
            // The callback is serialized and runs inside the remote page, not in this Worker, so it
            // cannot name a DOM type this build has no lib for; the shape is asserted structurally.
            // Capped because a link farm should not be able to make the response unbounded.
            .$$eval("a[href]", (anchors) =>
              anchors.map((anchor) => (anchor as unknown as { href: string }).href).slice(0, 500),
            )
            .catch(() => [] as string[]),
        ]);
        const finalUrl = page.url();

        await stub.write({
          sessionId: browser.sessionId(),
          location: finalUrl,
          openedAt:
            record !== null && sessionContinued(acquired.plan) ? record.openedAt : Date.now(),
        });

        // disconnect, NOT close: the browser must outlive this request for the next navigation to
        // find it. Closing here would make every hop a cold browser and delete the point.
        await browser.disconnect();
        browser = null;

        return c.json(
          {
            finalUrl,
            screenshotBase64: screenshot,
            ...(title !== undefined && { title }),
            links,
            sessionContinued: sessionContinued(acquired.plan),
          },
          200,
        );
      } catch (error) {
        // A navigation that died leaves a browser nobody will reconnect to, so drop the record
        // rather than pinning the member to it; the next navigation starts clean.
        await stub.end().catch(() => {});
        if (error instanceof SsrfRejection) {
          return problemJson(c, {
            type: "validation",
            status: 400,
            title: "The target URL is not a valid public address",
            detail: "The supplied URL did not resolve to a publicly routable address.",
          });
        }
        logOperationFailed(
          createWorkersLogger(c.env.TELEMETRY),
          "route:safeBrowse.liveNavigate",
          error instanceof RendererFailure ? error : new Error("live navigation failed"),
        );
        // The page not loading is the common outcome on the addresses this tool is pointed at, and
        // it is neither the member's fault nor an outage — the same answer the capture gives.
        return problemJson(c, {
          type: "page-render-failed",
          status: 422,
          title: "That page could not be rendered",
          detail:
            "The isolated browser reached the address but the page did not finish loading. It may be very slow, very large, or broken.",
        });
      } finally {
        if (browser !== null) await (browser as Browser).disconnect().catch(() => {});
      }
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
