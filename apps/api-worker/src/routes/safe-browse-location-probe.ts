/*
 * Which country does a website think the isolated browser is in — and can we choose it?
 *
 * It matters for this tool in particular. A page aimed at one country often shows its real content
 * only to visitors from there and something harmless to everyone else, so a member checking a link
 * that targets United States customers from a browser that surfaces in New Zealand may be looking
 * at the decoy. The rendering service accepts a `location` when a browser session is launched,
 * documented only as "ISO 3166-1 alpha-2 country code for the browser location" — which says neither
 * whether it is honoured nor whether it moves the address a website sees. The static capture's quick
 * actions do not document it at all.
 *
 * So this measures it, on the same terms as the session probe beside it: acquire, look, report,
 * close. It reads one constant address — the rendering service's own trace endpoint, which states
 * the visitor's country and the data centre that served it — three ways: a session with no location
 * asked for, a session with the requested one, and a quick action with it. Building a location
 * picker on the answer rather than on the documentation is the point.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It navigates only to the constant below, never to anything a
 * caller supplies; the one input is a two-letter country code, which names no address. It must not
 * be extended into a browsing endpoint, for the reason the session probe gives.
 */
import puppeteer from "@cloudflare/puppeteer";
import type { Browser, BrowserWorker } from "@cloudflare/puppeteer";
import { type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

// The rendering service's own trace endpoint: plain text, no scripts, and it reports `loc=` (the
// visitor's country as it geolocates them) and `colo=` (the data centre that answered).
const TRACE_TARGET = "https://www.cloudflare.com/cdn-cgi/trace";

// The quick-action path is reached through the binding's own method, which the puppeteer types do
// not describe; the same minimal shape the capture route uses.
interface QuickActionBinding {
  quickAction(action: string, options: Record<string, unknown>): Promise<Response>;
}

const LocationProbeQuery = z.object({
  // Upper-case ISO 3166-1 alpha-2. Validated for shape here; whether the service accepts the
  // particular code is part of what the probe reports.
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .default("US"),
});

const Observation = z.object({
  /** The country the trace endpoint reported, or null when the path failed before it could say. */
  country: z.string().nullable(),
  /** The data centre that answered, as the trace endpoint names it. */
  dataCenter: z.string().nullable(),
  /** Why this path produced no observation, when it did not. */
  failure: z.string().optional(),
});

const LocationProbeReport = z
  .object({
    requestedCountry: z.string(),
    /** A session launched with no location at all — what happens today. */
    sessionDefault: Observation,
    /** A session launched with the requested location. */
    sessionRequested: Observation,
    /** A quick action carrying the requested location — the static capture's path. */
    quickActionRequested: Observation,
    /** Whether a session asked for a country surfaced there. The fact a picker would stand on. */
    sessionHonoursLocation: z.boolean(),
    quickActionHonoursLocation: z.boolean(),
  })
  .openapi("SafeBrowseLocationProbe");

const locationProbeMeta: RouteMeta = {
  operationId: "safeBrowse.locationProbe",
  surface: "app",
  authenticated: true,
  permission: "tools:safeBrowse",
  resource: "firm",
  // Audited and on the expensive bucket for the session probe's reasons: every run acquires real
  // browsers from a small shared budget and is billed for holding them.
  audited: true,
  idempotency: "optional",
  rateLimit: "expensive",
};

const locationProbeRoute = defineOpenAPIRoute(locationProbeMeta, {
  method: "post",
  path: "/api/v1/safe-browse/location-probe",
  description:
    "Diagnostic: read the rendering service's trace endpoint from a browser session launched with " +
    "no location, from one launched with the requested country, and through a quick action carrying " +
    "it — reporting the country a website sees each time. Answers whether the isolated browser's " +
    "apparent country can be chosen. Navigates only to a constant; the one input is a country code.",
  request: { query: LocationProbeQuery },
  responses: {
    200: {
      description: "The probe ran; each observation says what a website saw, or why it could not",
      content: { "application/json": { schema: LocationProbeReport } },
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
      description: "The country is not a two-letter upper-case code",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

type Observed = z.infer<typeof Observation>;

/** Read `loc=` and `colo=` out of the trace endpoint's plain-text answer. */
export function readTrace(text: string): Pick<Observed, "country" | "dataCenter"> {
  const field = (name: string): string | null =>
    new RegExp(`(?:^|\\n)${name}=([^\\n]+)`).exec(text)?.[1]?.trim() ?? null;
  return { country: field("loc"), dataCenter: field("colo") };
}

function failed(error: unknown): Observed {
  return {
    country: null,
    dataCenter: null,
    failure: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  };
}

async function observeThroughSession(binding: BrowserWorker, country?: string): Promise<Observed> {
  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch(binding, {
      keep_alive: 60_000,
      // The type is a closed union of codes; the probe's input is validated for shape only, so
      // whether the service knows this particular code is what the failure field reports.
      ...(country !== undefined && { location: country as never }),
    });
    const page = await browser.newPage();
    await page.goto(TRACE_TARGET, { waitUntil: "load", timeout: 20_000 });
    const text = await page.evaluate(() =>
      String(
        (globalThis as unknown as { document?: { body?: { innerText?: string } } }).document?.body
          ?.innerText ?? "",
      ),
    );
    return readTrace(text);
  } catch (error) {
    return failed(error);
  } finally {
    // Close, not disconnect: nothing will reconnect to a probe's browser, and a held one is billed.
    if (browser !== null) await (browser as Browser).close().catch(() => {});
  }
}

async function observeThroughQuickAction(
  binding: QuickActionBinding,
  country: string,
): Promise<Observed> {
  try {
    const response = await binding.quickAction("content", { url: TRACE_TARGET, location: country });
    const body = (await response.json().catch(() => null)) as {
      success?: boolean;
      result?: string;
      errors?: { code?: number }[];
    } | null;
    if (!response.ok || body?.success !== true || typeof body.result !== "string") {
      const code = body?.errors?.[0]?.code;
      return failed(
        new Error(`quick action refused (http=${response.status}, code=${code ?? "none"})`),
      );
    }
    return readTrace(body.result);
  } catch (error) {
    return failed(error);
  }
}

export function registerSafeBrowseLocationProbeRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...locationProbeRoute, middleware: chokepointMiddleware(chokepoint, locationProbeRoute) },
    async (c) => {
      const { country } = c.req.valid("query");
      const binding = c.env.BROWSER;
      // Sequential, not parallel: three browsers at once would spend three of the account's small
      // acquisition budget in one instant for a diagnostic.
      const sessionDefault = await observeThroughSession(binding as BrowserWorker);
      const sessionRequested = await observeThroughSession(binding as BrowserWorker, country);
      const quickActionRequested = await observeThroughQuickAction(
        binding as unknown as QuickActionBinding,
        country,
      );
      return c.json(
        {
          requestedCountry: country,
          sessionDefault,
          sessionRequested,
          quickActionRequested,
          sessionHonoursLocation: sessionRequested.country === country,
          quickActionHonoursLocation: quickActionRequested.country === country,
        },
        200,
      );
    },
  );
}
