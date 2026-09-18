import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { captureSafeView, RendererFailure, type CaptureStage } from "@magna-carta/safe-browse";
import type { BrowserRenderer, RedirectProbe } from "@magna-carta/safe-browse/types";
import { SsrfRejection, assertPublicTarget } from "@magna-carta/integrations/safe-target";
import { newErrorId } from "@magna-carta/telemetry/ids";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import { runInBackground } from "../background.ts";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

// The deps the safe-browse route accepts from outside (tests pass fakes; production
// defaults are built from the env bindings below). Partial so callers only override
// what they need — the remainder falls through to the production adapters.
export type SafeBrowseRouteDeps = Partial<{
  renderer: BrowserRenderer;
  probe: RedirectProbe;
  resolve: (host: string) => Promise<readonly string[]>;
}>;

// Minimal interface for the Browser Rendering Workers binding. The official abstract class
// `BrowserRun` in @cloudflare/workers-types/experimental exports the same signature; we use
// a minimal structural interface here so the route file does not need to import from the
// experimental types barrel, keeping the dependency surface narrow.
interface BrowserRunBinding {
  quickAction(action: string, options: Record<string, unknown>): Promise<Response>;
}

// The service names its refusal in an `errors` array; the first entry's code is the actionable
// one. ONLY the code crosses into the failure — the message beside it can quote the target back,
// and RendererFailure exists to be loggable, which it can only be if it cannot hold a URL.
function rendererFailure(
  httpStatus: number,
  body: { errors?: { code?: number }[] } | null,
): RendererFailure {
  const code = body?.errors?.[0]?.code;
  return new RendererFailure(httpStatus, typeof code === "number" ? code : null);
}

// What reaches the log when a capture dies after the stream has begun. A RendererFailure states
// the service's status and code and provably carries no target, so it is quoted; anything else
// may have the suspect URL in its message, so only the Error ID crosses and the correlation is
// made through that. The name is preserved either way — which class failed is the first thing a
// reader wants, and `logOperationFailed` records it.
function sanitizedStreamFailure(error: unknown, errorId: string): Error {
  if (error instanceof RendererFailure) {
    const sanitized = new Error(`${error.message}; errorId=${errorId}`);
    sanitized.name = error.name;
    return sanitized;
  }
  return new Error(`capture failed after the stream began; errorId=${errorId}`);
}

// Production BrowserRenderer: delegates to the Browser Rendering Workers binding via
// quickAction("snapshot", ...), which returns HTML content + a base64 screenshot in one
// call. Links are extracted with a separate best-effort call — a failed links call must
// NOT fail the capture (capacity/network errors on links are tolerated).
//
// Snapshot result envelope (BrowserRunSnapshotSuccessResponse):
//   { success: true, result: { content: string; screenshot: string }, meta: { status: number; title: string } }
// Failure envelope: { success: false, errors: [{ code: number, message: string }] } — the message
//   is never read, per rendererFailure above.
// Links result envelope (BrowserRunLinksSuccessResponse):
//   { success: true, result: string[] }
export function createBrowserRenderer(browser: BrowserRunBinding): BrowserRenderer {
  return {
    async snapshot(url: string) {
      const snapshotResponse = await browser.quickAction("snapshot", {
        url,
        formats: ["screenshot", "markdown"],
        // The capture is only useful once the page has actually finished: without these options
        // the browser shot a client-rendered page mid-load (skeleton placeholders where the
        // content goes) and only the first viewport of it. networkidle2 rather than networkidle0
        // because sites with persistent connections (analytics, sockets) never reach zero and
        // would ride the timeout every time; the settle delay after network-idle gives
        // lazy-rendered content a beat to paint; fullPage captures the whole scrollable page.
        gotoOptions: { waitUntil: "networkidle2", timeout: 45_000 },
        // Sweep the page once before the shot: below-the-fold images lazy-load on scroll, so a
        // full-page screenshot without a sweep captures gray placeholders under the first
        // viewport. The injected script steps to the bottom (bounded, so an infinite-scroll feed
        // cannot hold the capture hostage) and returns to the top; the waitForTimeout after it
        // covers the sweep plus the image loads it triggers.
        addScriptTag: [
          {
            content:
              "(() => { let step = 0; const timer = setInterval(() => { step += 1; window.scrollBy(0, window.innerHeight); const bottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight; if (bottom || step >= 30) { clearInterval(timer); window.scrollTo(0, 0); } }, 120); })();",
          },
        ],
        waitForTimeout: 6_000,
        screenshotOptions: { fullPage: true },
      });
      // A refusal may arrive as a non-2xx, or as a 2xx carrying `success: false`; both shapes put
      // the reason in `errors`. An unparseable body is a refusal too — the service answered with
      // something that is not its envelope — so the parse failure resolves to null rather than
      // throwing a SyntaxError that would reach the member as an unexplained server fault.
      const snapshotBody = (await snapshotResponse.json().catch(() => null)) as {
        success?: boolean;
        result?: { content?: string; screenshot?: string; markdown?: string };
        meta?: { title?: string };
        errors?: { code?: number }[];
      } | null;

      if (!snapshotResponse.ok || snapshotBody === null || snapshotBody.success !== true) {
        throw rendererFailure(snapshotResponse.status, snapshotBody);
      }

      // Links are a best-effort companion call — a failure here must not fail the capture.
      let links: readonly string[] = [];
      try {
        const linksResponse = await browser.quickAction("links", { url });
        const linksBody = (await linksResponse.json()) as {
          success?: boolean;
          result?: string[];
        };
        links = linksBody.result ?? [];
      } catch {
        links = [];
      }

      return {
        screenshotBase64: snapshotBody.result?.screenshot ?? "",
        content: snapshotBody.result?.content,
        markdown: snapshotBody.result?.markdown,
        title: snapshotBody.meta?.title,
        links,
      };
    },
  };
}

// Production RedirectProbe: follows redirects one hop at a time using the global `fetch`
// with redirect:"manual", re-guarding EACH hop through assertPublicTarget to close the
// redirect-to-private-host gap. Bodies are discarded; only status/headers/location are
// captured. Caps at 10 hops to prevent redirect loops.
export function createFetchRedirectProbe(
  resolve?: (host: string) => Promise<readonly string[]>,
): RedirectProbe {
  return {
    async follow(startUrl: string) {
      const maxHops = 10;
      const hopTimeout = 10_000; // 10 s per hop

      const chain: Array<{ url: string; status: number; location?: string }> = [];
      let current = startUrl;
      let finalHeaders: Record<string, string> = {};

      for (let hop = 0; hop < maxHops; hop++) {
        // Re-guard each hop — a server could redirect to a private host.
        await assertPublicTarget(current, resolve);

        const response = await fetch(current, {
          method: "GET",
          redirect: "manual",
          signal: AbortSignal.any([AbortSignal.timeout(hopTimeout)]),
        });

        // Capture final headers at every hop; the last hop's headers are what we return.
        finalHeaders = Object.fromEntries(response.headers);

        const locationHeader = response.headers.get("location");
        const location = locationHeader ?? undefined;

        chain.push({ url: current, status: response.status, location });

        // Discard the body to avoid holding a connection open.
        await response.body?.cancel();

        if (response.status >= 300 && response.status < 400 && locationHeader !== null) {
          // Resolve relative redirects against the current URL.
          current = new URL(locationHeader, current).href;
        } else {
          // Not a redirect — we have reached the final destination.
          break;
        }
      }

      return { chain, finalUrl: current, headers: finalHeaders };
    },
  };
}

const SafeBrowseRequest = z.object({
  url: z.string().min(1).max(2048),
});

const RedirectHopSchema = z.object({
  url: z.string(),
  status: z.number(),
  location: z.string().optional(),
});

const SafeBrowseResponse = z
  .object({
    requestedUrl: z.string(),
    finalUrl: z.string(),
    redirectChain: z.array(RedirectHopSchema),
    responseHeaders: z.record(z.string(), z.string()),
    screenshotBase64: z.string(),
    title: z.string().optional(),
    markdown: z.string().optional(),
    links: z.array(z.string()),
  })
  .openapi("SafeWebsiteView");

// Read-only, per-firm. The chokepoint resolves the session + firm and enforces
// tools:safeBrowse; the handler delegates to captureSafeView which runs the SSRF
// guard, the redirect probe, and the remote browser renderer behind injected deps.
// The rendered page's JS never executes in the user's browser — the snapshot is inert.
export const safeBrowseMeta: RouteMeta = {
  operationId: "safeBrowse.post",
  surface: "app",
  authenticated: true,
  permission: "tools:safeBrowse",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const safeBrowseRoute = defineOpenAPIRoute(safeBrowseMeta, {
  method: "post",
  path: "/api/v1/safe-browse",
  description:
    "Render a potentially malicious URL in an isolated remote browser and return a static snapshot " +
    "(screenshot, redirect chain, response headers, links) — no code runs in the user's browser.",
  request: {
    body: {
      content: { "application/json": { schema: SafeBrowseRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Static snapshot of the rendered page",
      content: { "application/json": { schema: SafeBrowseResponse } },
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
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
    502: {
      description: "The remote browser renderer is unavailable or at capacity",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

// The streaming twin of safeBrowse.post: same input, same permission, but the 200 is a
// newline-delimited JSON stream of capture stages so the page can narrate real progress — the
// probe and the renderer run in parallel, and the redirect chain usually settles well before the
// screenshot. Line protocol (one JSON object per line):
//   {"stage":"probing"}
//   {"stage":"probed","redirectCount":<n>,"finalUrl":"<url>"}
//   {"stage":"complete","view":<SafeWebsiteView>}          (terminal)
//   {"stage":"failed","problem":{"status":<n>,"errorId"?}} (terminal)
// Refusals that precede the stream (the SSRF guard, auth, permission, rate limit) answer as
// ordinary problem documents; once the 200 has begun, a failure arrives as the "failed" line.
export const safeBrowseStreamMeta: RouteMeta = {
  operationId: "safeBrowse.stream",
  surface: "app",
  authenticated: true,
  permission: "tools:safeBrowse",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const safeBrowseStreamRoute = defineOpenAPIRoute(safeBrowseStreamMeta, {
  method: "post",
  path: "/api/v1/safe-browse/stream",
  description:
    "The streaming variant of the safe-browse capture: renders a potentially malicious URL in an " +
    "isolated remote browser, emitting newline-delimited JSON stage lines while it works " +
    '({"stage":"probing"}, {"stage":"probed",...}) and ending with a terminal line — ' +
    '{"stage":"complete","view":...} carrying the same SafeWebsiteView the non-streaming route ' +
    'returns, or {"stage":"failed","problem":{...}} when the capture fails after the stream began.',
  request: {
    body: {
      content: { "application/json": { schema: SafeBrowseRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description:
        "Newline-delimited JSON capture stages, ending with a complete or failed terminal line",
      content: { "application/x-ndjson": { schema: z.string() } },
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
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerSafeBrowseStreamRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
  deps: SafeBrowseRouteDeps,
): void {
  app.openapi(
    {
      ...safeBrowseStreamRoute,
      middleware: chokepointMiddleware(chokepoint, safeBrowseStreamRoute),
    },
    async (c) => {
      const { url } = c.req.valid("json");

      // The guard runs BEFORE the stream starts so a rejected target answers a clean 400 problem
      // document, never a 200 that fails one line in. captureSafeView re-runs it internally
      // (defense in depth, and it re-guards every redirect hop).
      try {
        await assertPublicTarget(url, deps.resolve);
      } catch (error) {
        if (error instanceof SsrfRejection) {
          // Never echo the raw URL or resolved host — same redaction as the non-streaming route.
          return problemJson(c, {
            type: "validation",
            status: 400,
            title: "The target URL is not a valid public address",
            detail: "The supplied URL did not resolve to a publicly routable address.",
          });
        }
        throw error;
      }

      const renderer = deps.renderer ?? createBrowserRenderer(c.env.BROWSER as BrowserRunBinding);
      const probe = deps.probe ?? createFetchRedirectProbe(deps.resolve);

      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();
      const writeLine = (line: unknown): Promise<void> =>
        writer.write(encoder.encode(`${JSON.stringify(line)}\n`)).catch(() => {
          // The client went away mid-stream; the capture finishes on waitUntil regardless.
        });

      const run = async (): Promise<void> => {
        try {
          const view = await captureSafeView(
            url,
            { renderer, probe, resolve: deps.resolve },
            (stage: CaptureStage) => void writeLine(stage),
          );
          await writeLine({
            stage: "complete",
            view: {
              requestedUrl: view.requestedUrl,
              finalUrl: view.finalUrl,
              redirectChain: [...view.redirectChain].map((hop) =>
                Object.assign(
                  { url: hop.url, status: hop.status },
                  hop.location !== undefined && { location: hop.location },
                ),
              ),
              responseHeaders: { ...view.responseHeaders },
              screenshotBase64: view.screenshotBase64,
              ...(view.title !== undefined && { title: view.title }),
              ...(view.markdown !== undefined && { markdown: view.markdown }),
              links: [...view.links],
            },
          });
        } catch (error) {
          // The same mapping as the non-streaming route, delivered as the terminal line because
          // the 200 has already begun. A mid-chain SSRF rejection (a redirect to a private host)
          // is an input-class refusal; a renderer refusal the service called momentary is the
          // transient 502; anything else — a renderer refusal about our configuration included —
          // is a server fault carrying a freshly minted Error ID that is ALSO logged (sanitized,
          // per sanitizedStreamFailure: the raw error may carry the suspect URL).
          if (error instanceof SsrfRejection) {
            await writeLine({ stage: "failed", problem: { status: 400 } });
          } else if (error instanceof RendererFailure && error.kind === "transient") {
            // Logged even though the member is simply told to retry. This path answered and wrote
            // nothing before, which is precisely why a live refusal could not be read; the
            // message names the status and code the service gave and can hold nothing else.
            logOperationFailed(
              createWorkersLogger(c.env.TELEMETRY),
              "route:safeBrowse.stream",
              error,
            );
            await writeLine({ stage: "failed", problem: { status: 502 } });
          } else {
            const errorId = newErrorId();
            logOperationFailed(
              createWorkersLogger(c.env.TELEMETRY),
              "route:safeBrowse.stream",
              sanitizedStreamFailure(error, errorId),
            );
            await writeLine({ stage: "failed", problem: { status: 500, errorId } });
          }
        } finally {
          await writer.close().catch(() => {});
        }
      };

      // The capture outlives the handler return (the response IS the stream); background-tracked
      // so the test harness's teardown barrier sees it.
      runInBackground(c, run());

      // A plain Response (the downloads route's streaming idiom): the typed c.json helpers cannot
      // carry a ReadableStream body against the declared string schema, and zod-openapi's handler
      // type has no streaming shape — the cast is the same accepted escape billing's paged reads
      // use for bodies the type machinery cannot express.
      return new Response(readable, {
        status: 200,
        headers: { "content-type": "application/x-ndjson" },
      }) as never;
    },
  );
}

export function registerSafeBrowseRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
  deps: SafeBrowseRouteDeps,
): void {
  app.openapi(
    { ...safeBrowseRoute, middleware: chokepointMiddleware(chokepoint, safeBrowseRoute) },
    async (c) => {
      const { url } = c.req.valid("json");

      // Build effective deps: use injected overrides (tests), fall back to production adapters
      // that read the BROWSER binding from c.env. The BROWSER binding is NEVER accessed when
      // a renderer override is supplied — so tests run entirely without Miniflare browser support.
      const renderer = deps.renderer ?? createBrowserRenderer(c.env.BROWSER as BrowserRunBinding);
      const probe = deps.probe ?? createFetchRedirectProbe(deps.resolve);

      try {
        const view = await captureSafeView(url, { renderer, probe, resolve: deps.resolve });

        // SafeView uses readonly arrays; SafeBrowseResponse expects mutable arrays.
        return c.json(
          {
            requestedUrl: view.requestedUrl,
            finalUrl: view.finalUrl,
            redirectChain: [...view.redirectChain].map((hop) =>
              Object.assign(
                {
                  url: hop.url,
                  status: hop.status,
                },
                hop.location !== undefined && { location: hop.location },
              ),
            ),
            responseHeaders: { ...view.responseHeaders },
            screenshotBase64: view.screenshotBase64,
            ...(view.title !== undefined && { title: view.title }),
            ...(view.markdown !== undefined && { markdown: view.markdown }),
            links: [...view.links],
          },
          200,
        );
      } catch (error) {
        if (error instanceof SsrfRejection) {
          // Never echo the raw URL or resolved host into the response — return a generic
          // message that does not leak the user-supplied target or any resolved IP address.
          return problemJson(c, {
            type: "validation",
            status: 400,
            title: "The target URL is not a valid public address",
            detail: "The supplied URL did not resolve to a publicly routable address.",
          });
        }
        // A renderer refusal the service said is momentary → 502 and "try again shortly", which is
        // now only said when it is true. It is logged HERE because this is the one failure that
        // answers without reaching the global handler, and answering silently is what left the
        // first live refusal with no trace at all.
        //
        // Every other refusal — an entitlement that is not enabled, a credential without the
        // permission, a rejected parameter — is a fault in how this worker is calling the service.
        // Waiting cannot fix it and the member cannot act on it, so it falls through to the global
        // handler and reaches them as a 500 with an Error ID to quote. It is deliberately NOT
        // logged here as well: that handler logs it against the very Error ID the member is shown,
        // and a second line under a second ID is one the member can never quote. Letting a
        // RendererFailure through is safe — it holds a status and a code and provably not the
        // target, so the message the handler records cannot carry the suspect URL.
        if (error instanceof RendererFailure && error.kind === "transient") {
          logOperationFailed(createWorkersLogger(c.env.TELEMETRY), "route:safeBrowse.post", error);
          return problemJson(c, {
            type: "internal",
            status: 502,
            title: "The remote browser renderer is temporarily unavailable",
            detail: "The rendering service could not be reached. Please try again shortly.",
          });
        }
        throw error;
      }
    },
  );
}
