/*
 * Safe website viewer — the fetch-and-classify seam for the Safe Website Viewer page. The suspect
 * page is rendered in Cloudflare's isolated remote browser by the worker route
 * (apps/api-worker/src/routes/safe-browse.ts); what arrives here is already inert — a base64
 * screenshot and plain text — and this module keeps it that way: nothing in the view is ever
 * re-rendered as live markup, and the page's outbound links are shown as text, never as anchors.
 *
 * The branching that decides which page state a capture resolves to lives here, out of the
 * component, so it is unit-testable without a DOM (see apps/web/test/safe-browse.test.ts). The
 * capture endpoint answers over the same-origin API with a raw fetch, matching the WHOIS page's
 * approach in apps/web/src/lib/tools/whois/whois-lookup.ts — apps/web does not depend on
 * @magna-carta/api-client.
 *
 * SafeWebsiteView mirrors the generated SafeWebsiteView in packages/api-client/src/types.gen.ts;
 * move to that generated type when apps/web adopts the client.
 */

import { readProblem, requestLine, type Failure, type Problem } from "$lib/api/problem.ts";
import { guidanceForProblem, type ProblemGuidance } from "$lib/diagnostics/guidance.ts";

export interface RedirectHop {
  url: string;
  status: number;
  location?: string;
}

export interface SafeWebsiteView {
  requestedUrl: string;
  finalUrl: string;
  redirectChain: RedirectHop[];
  responseHeaders: Record<string, string>;
  screenshotBase64: string;
  title?: string;
  markdown?: string;
  links: string[];
}

// A failed capture surfaced to the user, as the shared problem record ($lib/api/problem.ts). This
// module kept a private two-field copy of that parser until there was one home for it; the local
// name stays because the guidance below is keyed to this tool's own renderer semantics.
export type SafeBrowseProblem = Problem;

// The distinct states a capture resolves to. A 200 always carries a view (there is no "empty"
// capture — the remote browser either rendered something or the route failed); the component
// decides panel-by-panel what the view has to show. The two failing kinds carry the failure record
// every failure surface renders from.
export type SafeBrowseOutcome =
  | { kind: "view"; view: SafeWebsiteView }
  | { kind: "problem"; problem: SafeBrowseProblem; failure: Failure }
  | { kind: "transport"; failure: Failure };

export type { ProblemTone, ProblemGuidance } from "$lib/diagnostics/guidance.ts";

const SAFE_BROWSE_ENDPOINT = "/api/v1/safe-browse";

/**
 * Normalize what a member pasted into the URL the route accepts, or null when it cannot be one.
 * A bare domain ("example.com") gets an https scheme; an explicit non-web scheme ("file:",
 * "javascript:") is refused here rather than sent — the server would refuse it too, but the member
 * gets the input guidance without a round trip. Only the shape is checked client-side; whether the
 * target is a public address stays the server-side SSRF guard's call.
 */
export function normalizeTarget(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "" || trimmed.length > 2048) return null;

  // An explicit scheme is anything letter-led before "://" or a known scheme-colon form. A bare
  // "host:port" ("example.com:8080") parses as scheme "example.com" under WHATWG rules, so only
  // treat the input as carrying a scheme when it is followed by "//" or is clearly not a host.
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  const hasExplicitScheme =
    schemeMatch !== null && trimmed.slice(schemeMatch[0].length).startsWith("//");

  const candidate = hasExplicitScheme ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.hostname === "") return null;
  // A single bare label ("google") is not a website address: it parses as a URL but names no
  // public host, so it would only cost a round trip to be refused. A dot (domains, IPv4) or a
  // colon (bracketed IPv6) is the shape of something the capture can actually visit.
  if (!parsed.hostname.includes(".") && !parsed.hostname.includes(":")) return null;
  return parsed.href;
}

/**
 * The screenshot as an <img> source, or null when the renderer returned none. The route passes the
 * remote browser's base64 through verbatim; a value already carrying a data: prefix is used as-is.
 */
export function screenshotSource(screenshotBase64: string): string | null {
  if (screenshotBase64 === "") return null;
  if (screenshotBase64.startsWith("data:")) return screenshotBase64;
  return `data:image/png;base64,${screenshotBase64}`;
}

/**
 * Whether the capture ended on a different host than the one the member asked about — the signal a
 * cloaked or shortened link exists to hide. Compares hostnames only (a scheme upgrade or a path
 * move within one site is not "elsewhere"); an unparseable URL on either side reads as false
 * rather than raising an alarm the facts cannot back.
 */
export function landedOnDifferentHost(view: SafeWebsiteView): boolean {
  try {
    return new URL(view.requestedUrl).hostname !== new URL(view.finalUrl).hostname;
  } catch {
    return false;
  }
}

/** Response headers as sorted [name, value] pairs, so the panel renders in a stable order. */
export function sortedHeaders(headers: Record<string, string>): [string, string][] {
  return Object.entries(headers).sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Human guidance for a failed capture, keyed by HTTP status. Deliberately never echoes the target
 * or any resolved address: the 400 is generic on purpose — the worker route keeps it that way as
 * an SSRF guard, and the UI must not undo that by reflecting the input back. A 502 is the remote
 * renderer being unreachable or at capacity — transient, not worth quoting to support — while any
 * other server fault carries an Error ID for the member to quote.
 */
export function problemGuidance(problem: SafeBrowseProblem): ProblemGuidance {
  // The shared presenter ($lib/diagnostics/guidance.ts) supplies the floor, including the
  // service-skew 404 this surface learned the hard way and then carried alone. What stays here is
  // the guidance only this tool can give: what a 502 from the remote renderer means, and that an
  // input fault has nothing to press.
  const base = guidanceForProblem(problem, "The capture");

  // EVERY 404 goes back untouched, because the shared presenter tells the two apart and this
  // function cannot: one answered by no route at all is deploy skew, one carrying a problem
  // document is a record that is genuinely gone. Returning early matters — the input-fault default
  // below would otherwise clobber both and blame the member's address for a release that was still
  // rolling out, which is the exact misdiagnosis this tool shipped once already.
  if (problem.status === 404) return base;

  // The page itself did not finish rendering. Neither the member's address nor our service is at
  // fault, so neither of the answers below fits: one would send them to change an address that was
  // accepted and visited, the other would have them quote an Error ID for something support cannot
  // fix. The server has already retried with everything expensive turned off by the time this
  // arrives, so there is nothing left for a button to do.
  if (problem.type === "page-render-failed") {
    return {
      ...base,
      tone: "warning",
      title: "That page could not be rendered",
      message:
        "The isolated browser reached the address but the page did not finish loading. It may be " +
        "very slow, very large, or broken. The redirect chain and response headers below are still " +
        "what the address answered.",
      remedy: { kind: "retry" },
    };
  }

  if (problem.status === 502) {
    return {
      ...base,
      tone: "warning",
      title: "The isolated browser is not available right now",
      message:
        "The remote rendering service could not be reached or is at capacity. Wait a moment, then try again.",
    };
  }
  if (problem.status >= 500) {
    return {
      ...base,
      tone: "danger",
      title: "The capture failed",
      message: "Something went wrong on our side. Quote the Error ID below to support.",
    };
  }
  switch (problem.status) {
    case 401:
      return {
        ...base,
        tone: "info",
        title: "You are not signed in",
        message:
          "Captures run against an authenticated session. In local development there is no session yet, so the capture returns nothing.",
      };
    case 403:
      return {
        ...base,
        tone: "warning",
        title: "You do not have permission",
        message: "Your account is not allowed to use the Safe Website Viewer.",
      };
    case 429:
      return {
        ...base,
        tone: "warning",
        title: "Too many captures",
        message: "You have run several captures in a short time. Wait a moment, then try again.",
      };
    default:
      // 400 (invalid/blocked target) and a 422 that is NOT page-render-failed (the body failed
      // validation) — both are input faults, and neither is fixed by pressing anything on this
      // screen. The render failure is caught above precisely because it wears the same 422 and is
      // not an input fault at all.
      return {
        ...base,
        tone: "warning",
        title: "That address cannot be viewed",
        message:
          "Enter a web address (https://example.com). Private, local, and internal addresses are not accepted.",
        remedy: { kind: "none" },
      };
  }
}

const SAFE_BROWSE_STREAM_ENDPOINT = "/api/v1/safe-browse/stream";

/**
 * Progress the streaming capture reports while it runs. The worker's probe and renderer run in
 * parallel, so this is not a pipeline: "probing" arrives when both are dispatched, and "probed"
 * arrives when the redirect probe settles — usually well before the renderer, which is the point:
 * the page can say where the link really leads while the screenshot is still being rendered.
 * Mirrors CaptureStage in packages/safe-browse (the same mirroring note as SafeWebsiteView above).
 */
export type CaptureProgress =
  | { stage: "probing" }
  | { stage: "probed"; redirectCount: number; finalUrl: string };

/**
 * Capture with live progress: POSTs the streaming endpoint and reads its newline-delimited JSON
 * lines, invoking `onProgress` for each stage line and resolving on the terminal line
 * ({stage:"complete",view} or {stage:"failed",problem}). Pre-stream refusals (the SSRF 400, 401,
 * 403, 429) arrive as ordinary problem documents before anything streams. Never throws: a thrown
 * fetch, an unreadable stream, or a stream that ends without a terminal line reports `transport`.
 */
export async function viewSafelyStaged(
  url: string,
  onProgress: (progress: CaptureProgress) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<SafeBrowseOutcome> {
  // The request line never carries the target: requestLine drops the query, and the body is never
  // in it. A copyable trace block is exactly where a reflected address would leak back out.
  const line = requestLine("POST", SAFE_BROWSE_STREAM_ENDPOINT);
  const nothingAnswered = (): SafeBrowseOutcome => ({
    kind: "transport",
    failure: { problem: null, request: line, failedAt: new Date() },
  });

  let response: Response;
  try {
    response = await fetchImpl(SAFE_BROWSE_STREAM_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/x-ndjson" },
      body: JSON.stringify({ url }),
    });
  } catch {
    return nothingAnswered();
  }

  if (!response.ok) {
    // A 404 means the API behind this page is an older build without the streaming route (the
    // page and the service deploy as separate Workers). The non-streaming capture has existed
    // since the tool shipped, so fall back to it rather than failing on deploy skew — the member
    // loses the narration, not the capture.
    if (response.status === 404) return viewSafely(url, fetchImpl);
    const problem = await readProblem(response);
    return { kind: "problem", problem, failure: { problem, request: line, failedAt: new Date() } };
  }
  if (response.body === null) return nothingAnswered();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value !== undefined) buffered += decoder.decode(value, { stream: true });
      // Process every complete line; a terminal line resolves the capture.
      for (;;) {
        const newline = buffered.indexOf("\n");
        if (newline === -1) break;
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (line === "") continue;
        const parsed = JSON.parse(line) as
          | CaptureProgress
          | { stage: "complete"; view: SafeWebsiteView }
          | { stage: "failed"; problem: SafeBrowseProblem };
        if (parsed.stage === "complete") return { kind: "view", view: parsed.view };
        if (parsed.stage === "failed") {
          return {
            kind: "problem",
            problem: parsed.problem,
            failure: { problem: parsed.problem, request: line, failedAt: new Date() },
          };
        }
        onProgress(parsed);
      }
      if (done) break;
    }
  } catch {
    return nothingAnswered();
  }
  // The stream ended without a terminal line — the capture died mid-flight.
  return nothingAnswered();
}

/**
 * Capture a static snapshot of `url` in the isolated remote browser. Takes the already-normalized
 * target (normalizeTarget's output). `fetchImpl` is injectable so the branching is testable
 * without the network. Never throws: a thrown fetch (nothing answered) is reported as `transport`,
 * distinct from a server that answered with an error document.
 */
export async function viewSafely(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SafeBrowseOutcome> {
  const line = requestLine("POST", SAFE_BROWSE_ENDPOINT);
  const nothingAnswered = (): SafeBrowseOutcome => ({
    kind: "transport",
    failure: { problem: null, request: line, failedAt: new Date() },
  });

  let response: Response;
  try {
    response = await fetchImpl(SAFE_BROWSE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ url }),
    });
  } catch {
    return nothingAnswered();
  }

  if (!response.ok) {
    const problem = await readProblem(response);
    return { kind: "problem", problem, failure: { problem, request: line, failedAt: new Date() } };
  }

  let view: SafeWebsiteView;
  try {
    view = (await response.json()) as SafeWebsiteView;
  } catch {
    return nothingAnswered();
  }

  return { kind: "view", view };
}
