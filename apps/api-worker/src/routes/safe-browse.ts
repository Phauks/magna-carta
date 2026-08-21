import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { captureSafeView } from "@magna-carta/safe-browse";
import type { BrowserRenderer, RedirectProbe } from "@magna-carta/safe-browse/types";
import { SsrfRejection, assertPublicTarget } from "@magna-carta/integrations/safe-target";
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

// Production BrowserRenderer: delegates to the Browser Rendering Workers binding via
// quickAction("snapshot", ...), which returns HTML content + a base64 screenshot in one
// call. Links are extracted with a separate best-effort call — a failed links call must
// NOT fail the capture (capacity/network errors on links are tolerated).
//
// Snapshot result envelope (BrowserRunSnapshotSuccessResponse):
//   { success: true, result: { content: string; screenshot: string }, meta: { status: number; title: string } }
// Links result envelope (BrowserRunLinksSuccessResponse):
//   { success: true, result: string[] }
export function createBrowserRenderer(browser: BrowserRunBinding): BrowserRenderer {
  return {
    async snapshot(url: string) {
      const snapshotResponse = await browser.quickAction("snapshot", {
        url,
        formats: ["screenshot", "markdown"],
      });
      const snapshotBody = (await snapshotResponse.json()) as {
        success: boolean;
        result?: { content?: string; screenshot?: string; markdown?: string };
        meta?: { title?: string };
      };

      // A non-throwing failure response (capacity / limit) must be treated as an error so the
      // caller's catch block can map it to a 502. The thrown message contains "capacity" so the
      // 502 predicate below matches it.
      if (!snapshotBody.success) {
        throw new Error("Browser renderer returned a failure response (capacity or limit).");
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
        // Browser renderer capacity/limit/unavailable errors → 502 (redacted, correlated).
        // Only errors that clearly indicate a renderer failure are caught here; everything
        // else propagates to the standard telemetry error pipeline (→ 500 with Error ID).
        //
        // errorText feeds the 502 predicate only — MUST NOT be logged or echoed; it may
        // contain the suspect URL/host from upstream error messages.
        const errorText = error instanceof Error ? error.message : String(error);
        if (
          errorText.includes("429") ||
          errorText.includes("503") ||
          errorText.includes("capacity") ||
          errorText.includes("unavailable") ||
          errorText.includes("limit")
        ) {
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
