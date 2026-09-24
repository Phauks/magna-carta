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
 * execute — so even if the remote browser were compromised, only an image and text could reach
 * the member, which is the strongest safety argument the static capture has and survives this.
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

const LiveRedirectHop = z.object({
  url: z.string(),
  status: z.number(),
  location: z.string().optional(),
});

// The same fields the static capture answers with, field for field, plus one. That is a
// requirement rather than a convenience: the viewer's inspector renders one view shape, and a
// live answer missing the redirect chain would have to be padded with an empty one — at which
// point the Overview tab states "answered directly" about a link that may have bounced three
// times, which is the one fact this tool exists to get right.
const LiveView = z
  .object({
    requestedUrl: z.string(),
    finalUrl: z.string(),
    redirectChain: z.array(LiveRedirectHop),
    responseHeaders: z.record(z.string(), z.string()),
    screenshotBase64: z.string(),
    title: z.string().optional(),
    // The page's visible text. The static capture's renderer returns markdown under this name; a
    // held browser has no converter, so this is plain text — which the Text tab renders the same
    // way, as escaped preformatted text.
    markdown: z.string().optional(),
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
  // Audited on the same terms as the navigate: ending a session closes a browser the firm was
  // paying to hold, which is a real act on a real resource rather than housekeeping. The
  // non-mutating-POST allow-list is for posts that change nothing, and this changes something.
  audited: true,
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

// Caps on what a page can make this route carry. A hostile page chooses its own size.
const MAXIMUM_LINKS = 500;
const MAXIMUM_TEXT_CHARACTERS = 200_000;

/*
 * Navigate a held page with the SSRF guard on every hop the BROWSER takes, not only the one the
 * member typed.
 *
 * `page.goto` lets the remote browser follow server redirects on its own; guarding only the typed
 * address before calling it would leave every redirect unchecked, and a held session is exactly
 * where that matters — a hostile page has a whole session to send the browser somewhere it should
 * not go. So interception is switched on for the duration of the navigation and every navigation
 * request, in any frame, is resolved through `assertPublicTarget` before it is allowed to leave.
 *
 * A refused hop in a sub-frame blocks that frame and nothing else: an iframe pointing inward does
 * not make the page unviewable. A refused hop in the MAIN frame fails the navigation with the same
 * generic refusal the typed address would have drawn.
 *
 * What this does not guard, stated rather than implied: sub-resources (images, scripts, fetches)
 * are not resolved one by one — a page makes hundreds, and a lookup each would make every
 * navigation slow. That is the same line the static capture's renderer draws, and the browser
 * doing the fetching runs in the rendering service's network, not this platform's.
 *
 * Interception is switched OFF again before the caller disconnects. Left on, any request the page
 * made between navigations would pause waiting for a handler that no longer exists.
 */
async function navigateGuarded(
  page: Awaited<ReturnType<Browser["newPage"]>>,
  href: string,
): Promise<{ response: Awaited<ReturnType<typeof page.goto>> }> {
  let refusal: SsrfRejection | null = null;
  const mainFrame = page.mainFrame();

  const onRequest = (request: Parameters<Parameters<typeof page.on<"request">>[1]>[0]): void => {
    if (!request.isNavigationRequest()) {
      void request.continue().catch(() => {});
      return;
    }
    void assertPublicTarget(request.url()).then(
      () => request.continue().catch(() => {}),
      (error: unknown) => {
        if (error instanceof SsrfRejection && request.frame() === mainFrame) refusal = error;
        void request.abort("blockedbyclient").catch(() => {});
      },
    );
  };

  await page.setRequestInterception(true);
  page.on("request", onRequest);
  try {
    const response = await page.goto(href, { waitUntil: "load", timeout: 30_000 });
    if (refusal !== null) throw refusal;
    return { response };
  } catch (error) {
    // An aborted main-frame hop surfaces from goto as a network error; the refusal recorded above
    // is the real reason and is what the caller must see.
    if (refusal !== null) throw refusal;
    throw error;
  } finally {
    page.off("request", onRequest);
    await page.setRequestInterception(false).catch(() => {});
  }
}

/** What one live navigation produced, before the route adds the fact about the member's session. */
export interface LiveNavigationResult {
  /** The remote browser's session id, recorded so the next navigation can reconnect to it. */
  readonly sessionId: string;
  /** The plan actually carried out — a connect to a reaped browser comes back as a launch. */
  readonly plan: LiveSessionPlan;
  readonly finalUrl: string;
  readonly redirectChain: readonly { url: string; status: number; location?: string }[];
  readonly responseHeaders: Readonly<Record<string, string>>;
  readonly screenshotBase64: string;
  readonly title?: string;
  readonly text?: string;
  readonly links: readonly string[];
}

/*
 * The seam between the route and the remote browser, on the same terms as the static capture's
 * `BrowserRenderer`: production drives the Browser Rendering binding, tests pass a fake. It exists
 * because the local test pool has no browser at all, so without it the route's decisions — what a
 * refused redirect answers, whether a failure ends the session, whether a second navigation reuses
 * the first one's browser — could only ever be checked by hand against the deployed service.
 *
 * A navigator MUST leave the browser alive on success (disconnect, never close) and MUST run the
 * SSRF guard on every hop it follows, throwing `SsrfRejection` when a main-frame hop is refused.
 * The route owns everything else.
 */
export interface LiveNavigator {
  navigate(plan: LiveSessionPlan, href: string): Promise<LiveNavigationResult>;
}

export type SafeBrowseLiveRouteDeps = Partial<{ navigator: LiveNavigator }>;

/** The production navigator: a held Browser Rendering session driven over CDP. */
export function createPuppeteerLiveNavigator(binding: BrowserWorker): LiveNavigator {
  return {
    async navigate(plan, href) {
      let browser: Browser | null = null;
      try {
        const acquired = await browserForPlan(binding, plan);
        browser = acquired.browser;

        const pages = await browser.pages();
        const page = pages[0] ?? (await browser.newPage());
        const { response } = await navigateGuarded(page, href);
        // A short, bounded settle for client-rendered content. It never fails the navigation: a
        // page that never goes quiet is shot as it stands rather than refused.
        await page.waitForNetworkIdle({ idleTime: 500, timeout: 3_000 }).catch(() => {});

        const [screenshot, title, links, text] = await Promise.all([
          page.screenshot({ encoding: "base64", fullPage: true }) as Promise<string>,
          page.title().catch(() => undefined),
          page
            // The callback is serialized and runs inside the remote page, not in this Worker, so it
            // cannot name a DOM type this build has no lib for; the shape is asserted structurally.
            .$$eval(
              "a[href]",
              (anchors, maximum) =>
                anchors
                  .map((anchor) => (anchor as unknown as { href: string }).href)
                  .slice(0, maximum),
              MAXIMUM_LINKS,
            )
            .catch(() => [] as string[]),
          page
            .evaluate(
              (maximum) =>
                String(
                  (globalThis as unknown as { document?: { body?: { innerText?: string } } })
                    .document?.body?.innerText ?? "",
                ).slice(0, maximum),
              MAXIMUM_TEXT_CHARACTERS,
            )
            .catch(() => undefined),
        ]);

        // The chain the browser actually followed: every hop that redirected, then the answer it
        // settled on. Read off the navigation itself rather than probed separately, so it is the
        // chain this session walked — cookies and all — and not a cookieless re-fetch's guess.
        const redirectChain = [
          ...(response?.request().redirectChain() ?? []).map((hop) => {
            const hopResponse = hop.response();
            const location = hopResponse?.headers()["location"];
            return {
              url: hop.url(),
              status: hopResponse?.status() ?? 0,
              ...(location !== undefined && { location }),
            };
          }),
          ...(response !== null ? [{ url: response.url(), status: response.status() }] : []),
        ];

        const result: LiveNavigationResult = {
          sessionId: browser.sessionId(),
          plan: acquired.plan,
          finalUrl: page.url(),
          redirectChain,
          responseHeaders: response?.headers() ?? {},
          screenshotBase64: screenshot,
          ...(title !== undefined && { title }),
          ...(text !== undefined && text !== "" && { text }),
          links,
        };

        // disconnect, NOT close: the browser must outlive this request for the next navigation to
        // find it. Closing here would make every hop a cold browser and delete the point.
        await browser.disconnect();
        browser = null;
        return result;
      } finally {
        if (browser !== null) await (browser as Browser).disconnect().catch(() => {});
      }
    },
  };
}

export function registerSafeBrowseLiveRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
  deps: SafeBrowseLiveRouteDeps = {},
): void {
  app.openapi(
    { ...liveNavigateRoute, middleware: chokepointMiddleware(chokepoint, liveNavigateRoute) },
    async (c) => {
      const { url } = c.req.valid("json");

      // The typed address first, before anything outbound, so a private target never costs a
      // browser acquisition. Every hop after it — each redirect the browser follows — is guarded
      // again inside navigateGuarded, which is where the per-hop half of the rule lives.
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

      // The binding is read only when no navigator was supplied, so the test pool — which has no
      // browser — never touches it.
      const navigator =
        deps.navigator ?? createPuppeteerLiveNavigator(c.env.BROWSER as BrowserWorker);
      try {
        const result = await navigator.navigate(planned, target.url.href);
        const continued = sessionContinued(result.plan);

        await stub.write({
          sessionId: result.sessionId,
          location: result.finalUrl,
          openedAt: record !== null && continued ? record.openedAt : Date.now(),
        });

        return c.json(
          {
            requestedUrl: url,
            finalUrl: result.finalUrl,
            redirectChain: result.redirectChain.map((hop) => ({ ...hop })),
            responseHeaders: { ...result.responseHeaders },
            screenshotBase64: result.screenshotBase64,
            ...(result.title !== undefined && { title: result.title }),
            ...(result.text !== undefined && { markdown: result.text }),
            links: [...result.links],
            sessionContinued: continued,
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
