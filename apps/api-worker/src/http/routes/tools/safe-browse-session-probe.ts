/*
 * Can this deployment hold a browser session open, and drive it over CDP?
 *
 * The safe website viewer's static capture reaches the rendering service through quick actions,
 * which are one request in and one answer out: the browser that served a capture is gone before the
 * next one starts. Interactive browsing needs the opposite — one browser that survives across
 * requests, so a second navigation carries the cookies the first one set. That is a different API
 * against the same binding, and nothing in this repository had ever exercised it.
 *
 * This route exercises it, once, and reports what happened at each step. It exists because the
 * alternative was to design the interactive mode against an assumption: the previous round of work
 * on this tool spent weeks attributing every failed capture to an account entitlement that had been
 * working the whole time, and the lesson taken from it was to make the unknown answerable before
 * building on it rather than after.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. The target is a fixed, inert address held below, never anything
 * a caller supplies. That is not an oversight to be corrected when this grows up: a route that
 * navigates a real browser to a caller's address is the SSRF surface the whole safe-browse
 * subsystem is built to contain, and the guard that contains it belongs on the interactive route
 * when there is one, not bolted onto a diagnostic. This probe answers a question about the
 * PLATFORM. It is not a browsing endpoint and must never be extended into one.
 *
 * COST. Every run acquires a real browser session and is billed for the time it is held. The route
 * closes the browser in a finally block whatever happens, because a probe that leaks sessions would
 * be charging for the thing it exists to measure; `sessionsBefore` reports what was already open,
 * so a leak elsewhere shows up here rather than staying invisible.
 */
import puppeteer from "@cloudflare/puppeteer";
import type { Browser, BrowserWorker } from "@cloudflare/puppeteer";
import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

// A fixed, inert, well-known target. Chosen because it is reserved for exactly this use, loads
// without scripts, and — the point for a probe — cannot be mistaken for a caller's input.
const PROBE_TARGET = "https://example.com/";

// Long enough for the disconnect-and-reconnect below to be a real test of session survival, short
// enough that a probe whose Worker dies mid-run cannot hold a billed session for long. The service
// caps this at ten minutes; nothing here wants more than a few seconds of it.
const PROBE_KEEP_ALIVE_MILLISECONDS = 60_000;

const ProbeStep = z.object({
  name: z.string(),
  ok: z.boolean(),
  // Present only when the step failed. Carries the error's class and message, which on this route
  // is safe: every input is a constant in this file, so an upstream message cannot quote a
  // member's address back. An interactive route would NOT be able to say that.
  detail: z.string().optional(),
});

const SessionProbeReport = z
  .object({
    supported: z.boolean(),
    steps: z.array(ProbeStep),
    sessionsBefore: z.number(),
    maxConcurrentSessions: z.number().nullable(),
    allowedBrowserAcquisitions: z.number().nullable(),
    // Whether the SECOND navigation ran on the same browser the first one did. This is the single
    // fact interactive browsing stands on: false means every navigation pays a cold browser and
    // carries no cookies, which is the static capture again under a different name.
    sessionReused: z.boolean(),
    // Whether a CDP session attached and accepted Page.enable. Pixel streaming is CDP
    // (Page.startScreencast, Input.dispatch*), so a false here rules it out whatever else works.
    cdpAttached: z.boolean(),
    elapsedMilliseconds: z.number(),
  })
  .openapi("SafeBrowseSessionProbe");

// Gated on the viewer's own permission rather than a diagnostics one: the capability being probed
// IS the safe website viewer, and a member who cannot use the viewer has no business spending its
// browser minutes. audited — each run costs real money and holds a real session, so who ran it is
// worth a row even though the probe stores nothing.
const sessionProbeMeta: RouteMeta = {
  operationId: "safeBrowse.sessionProbe",
  surface: "app",
  authenticated: true,
  permission: "tools:safeBrowse",
  resource: "firm",
  audited: true,
  idempotency: "optional",
  // Every run acquires a real browser, so it shares the bucket the live route uses for the same
  // reason: the account's acquisition budget is small and shared across every member.
  rateLimit: "expensive",
};

const sessionProbeRoute = defineOpenAPIRoute(sessionProbeMeta, {
  method: "post",
  path: "/api/v1/safe-browse/session-probe",
  description:
    "Diagnostic: acquire a browser session against a fixed inert address, disconnect, reconnect to " +
    "the same session, navigate again, and attach a CDP session — reporting each step. Answers " +
    "whether this deployment can support interactive remote browsing. Navigates only to a constant " +
    "held in the route; it accepts no target and is not a browsing endpoint.",
  request: {},
  responses: {
    200: {
      description: "The probe ran; the report says how far it got",
      content: { "application/json": { schema: SessionProbeReport } },
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

type Step = { name: string; ok: boolean; detail?: string };

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/*
 * The probe itself, separated from the route so the ordering is readable in one screen. It never
 * throws: a step that fails is recorded and the run stops there, because every step after a failure
 * depends on it and reporting them as "false" would imply they were tried.
 */
async function runProbe(binding: BrowserWorker): Promise<z.infer<typeof SessionProbeReport>> {
  const startedAt = Date.now();
  const steps: Step[] = [];
  let sessionsBefore = 0;
  let maxConcurrentSessions: number | null = null;
  let allowedBrowserAcquisitions: number | null = null;
  let sessionReused = false;
  let cdpAttached = false;
  let browser: Browser | null = null;

  const record = async (name: string, act: () => Promise<void>): Promise<boolean> => {
    try {
      await act();
      steps.push({ name, ok: true });
      return true;
    } catch (error) {
      steps.push({ name, ok: false, detail: describe(error) });
      return false;
    }
  };

  try {
    // What the account already has open, and what it will allow. Read first so a probe that then
    // fails to acquire can say whether it was at the ceiling rather than leaving it a guess.
    const inventoried = await record("read limits and existing sessions", async () => {
      const [limits, active] = await Promise.all([
        puppeteer.limits(binding),
        puppeteer.sessions(binding),
      ]);
      sessionsBefore = active.length;
      maxConcurrentSessions = limits.maxConcurrentSessions;
      allowedBrowserAcquisitions = limits.allowedBrowserAcquisitions;
    });
    if (!inventoried) return report();

    let sessionId = "";
    const launched = await record("launch a browser session", async () => {
      browser = await puppeteer.launch(binding, {
        keep_alive: PROBE_KEEP_ALIVE_MILLISECONDS,
      });
      sessionId = browser.sessionId();
    });
    if (!launched) return report();

    const navigated = await record("navigate on the first connection", async () => {
      const page = await nonNullBrowser(browser).newPage();
      await page.goto(PROBE_TARGET, { waitUntil: "load", timeout: 20_000 });
    });
    if (!navigated) return report();

    // disconnect, NOT close: the question is whether the browser outlives the connection.
    const released = await record("disconnect, leaving the session alive", async () => {
      await nonNullBrowser(browser).disconnect();
      browser = null;
    });
    if (!released) return report();

    const reconnected = await record("reconnect to the same session", async () => {
      browser = await puppeteer.connect(binding, sessionId);
      sessionReused = nonNullBrowser(browser).sessionId() === sessionId;
    });
    if (!reconnected) return report();

    // The second navigation is the one that matters: it proves the reconnected handle drives a
    // browser that is actually there, rather than one the service quietly replaced.
    const navigatedAgain = await record("navigate again on the reused session", async () => {
      const pages = await nonNullBrowser(browser).pages();
      const page = pages[0] ?? (await nonNullBrowser(browser).newPage());
      await page.goto(PROBE_TARGET, { waitUntil: "load", timeout: 20_000 });
    });
    if (!navigatedAgain) return report();

    await record("attach a CDP session and enable Page", async () => {
      const pages = await nonNullBrowser(browser).pages();
      const page = pages[0] ?? (await nonNullBrowser(browser).newPage());
      const cdp = await page.createCDPSession();
      // Page.enable is the cheapest call that proves the CDP channel carries commands. The
      // screencast and input domains pixel streaming needs ride the same channel; enabling a
      // screencast here would start a frame stream with nothing to receive it.
      await cdp.send("Page.enable");
      cdpAttached = true;
    });

    return report();
  } finally {
    // Whatever happened, do not leave a billed session behind.
    if (browser !== null) {
      await (browser as Browser).close().catch(() => {});
    }
  }

  function report(): z.infer<typeof SessionProbeReport> {
    return {
      supported: sessionReused && cdpAttached,
      steps,
      sessionsBefore,
      maxConcurrentSessions,
      allowedBrowserAcquisitions,
      sessionReused,
      cdpAttached,
      elapsedMilliseconds: Date.now() - startedAt,
    };
  }
}

// The handle is nulled between steps to make the finally block's ownership obvious; this keeps the
// narrowing honest at each use without scattering non-null assertions through the steps.
function nonNullBrowser(browser: Browser | null): Browser {
  if (browser === null) throw new Error("the browser handle was released before this step");
  return browser;
}

export function registerSafeBrowseSessionProbeRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...sessionProbeRoute, middleware: chokepointMiddleware(chokepoint, sessionProbeRoute) },
    async (c) => {
      const report = await runProbe(c.env.BROWSER as BrowserWorker);
      // A probe that answered "no" is a successful probe — the report IS the answer, so it is a 200
      // either way. It is still logged, because an unsupported answer is the more interesting one
      // and nobody will think to look for it until they need it.
      if (!report.supported) {
        const failed = report.steps.find((step) => !step.ok);
        logOperationFailed(
          createWorkersLogger(c.env.TELEMETRY),
          "route:safeBrowse.sessionProbe",
          new Error(
            `browser sessions unsupported here; reused=${report.sessionReused} cdp=${report.cdpAttached} stoppedAt=${failed?.name ?? "none"}`,
          ),
        );
      }
      return c.json(report, 200);
    },
  );
}
