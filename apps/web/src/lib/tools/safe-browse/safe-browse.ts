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

// A failed capture surfaced to the user. `errorId` is the user-facing correlation handle carried on
// every RFC 9457 problem document — the platform mints one even on a 500 — so a member can quote it
// to support and it maps to the redacted server trace (the standard error pipeline in
// docs/conventions/error-logging.md).
export interface SafeBrowseProblem {
  status: number;
  errorId?: string;
}

// The distinct states a capture resolves to. A 200 always carries a view (there is no "empty"
// capture — the remote browser either rendered something or the route failed); the component
// decides panel-by-panel what the view has to show.
export type SafeBrowseOutcome =
  | { kind: "view"; view: SafeWebsiteView }
  | { kind: "problem"; problem: SafeBrowseProblem }
  | { kind: "transport" };

export type ProblemTone = "info" | "warning" | "danger";

export interface ProblemGuidance {
  tone: ProblemTone;
  title: string;
  message: string;
}

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
  if (problem.status === 502) {
    return {
      tone: "warning",
      title: "The isolated browser is not available right now",
      message:
        "The remote rendering service could not be reached or is at capacity. Wait a moment, then try again.",
    };
  }
  if (problem.status >= 500) {
    return {
      tone: "danger",
      title: "The capture failed",
      message: "Something went wrong on our side. Quote the Error ID below to support.",
    };
  }
  switch (problem.status) {
    case 401:
      return {
        tone: "info",
        title: "You are not signed in",
        message:
          "Captures run against an authenticated session. In local development there is no session yet, so the capture returns nothing.",
      };
    case 403:
      return {
        tone: "warning",
        title: "You do not have permission",
        message: "Your account is not allowed to use the Safe Website Viewer.",
      };
    case 429:
      return {
        tone: "warning",
        title: "Too many captures",
        message: "You have run several captures in a short time. Wait a moment, then try again.",
      };
    default:
      // 400 (invalid/blocked target) and 422 (the body failed validation) — both are input faults.
      return {
        tone: "warning",
        title: "That address cannot be viewed",
        message:
          "Enter a web address (https://example.com). Private, local, and internal addresses are not accepted.",
      };
  }
}

// Read the correlation handle off a problem document. Defensive: a body that is not JSON, or is
// missing the field, still yields a usable problem carrying the HTTP status.
async function readProblem(response: Response): Promise<SafeBrowseProblem> {
  try {
    const body = (await response.json()) as { errorId?: unknown };
    return {
      status: response.status,
      errorId: typeof body.errorId === "string" ? body.errorId : undefined,
    };
  } catch {
    return { status: response.status };
  }
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
  let response: Response;
  try {
    response = await fetchImpl(SAFE_BROWSE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ url }),
    });
  } catch {
    return { kind: "transport" };
  }

  if (!response.ok) {
    return { kind: "problem", problem: await readProblem(response) };
  }

  let view: SafeWebsiteView;
  try {
    view = (await response.json()) as SafeWebsiteView;
  } catch {
    return { kind: "transport" };
  }

  return { kind: "view", view };
}
