/*
 * WHOIS lookup — the fetch-and-classify seam for the WHOIS Lookup page. The branching that decides
 * which of the page's states to show lives here, out of the component, so it is unit-testable
 * without a DOM (see apps/web/test/whois-lookup.test.ts).
 *
 * The registration endpoint answers over the same-origin API. apps/web does not depend on
 * @magna-carta/api-client (adopting it is a scope decision the owner has not made), so this calls
 * the relative route with a raw same-origin fetch, matching the speed-test page's approach in
 * apps/web/src/lib/tools/speed-test/speed-test-engine.svelte.ts.
 *
 * WhoisResult mirrors the generated WhoisResponse in packages/api-client/src/types.gen.ts; move to
 * that generated type when apps/web adopts the client.
 */

import { readProblem, requestLine, type Failure, type Problem } from "$lib/api/problem.ts";
import { guidanceForProblem, type ProblemGuidance } from "$lib/diagnostics/guidance.ts";

export interface WhoisResult {
  source: "rdap" | "whois-43";
  target: string;
  registrar?: string;
  registeredAt?: string;
  expiresAt?: string;
  lastChangedAt?: string;
  nameservers?: string[];
  statuses?: string[];
  registrant?: string;
  raw?: string;
}

// A failed lookup surfaced to the user, as the shared problem record ($lib/api/problem.ts). This
// module kept a private two-field copy of that parser until there was one home for it; the local
// name stays because the guidance below is keyed to this surface's own registry semantics.
export type WhoisProblem = Problem;

// The distinct states a lookup resolves to. `rdap`/`raw`/`empty` share a body; the component
// discriminates on the exact kind to pick structured card, raw block, or "nothing found" notice.
// The two failing kinds carry the failure record every failure surface renders from.
export type WhoisOutcome =
  | { kind: "rdap" | "raw" | "empty"; result: WhoisResult }
  | { kind: "problem"; problem: WhoisProblem; failure: Failure }
  | { kind: "transport"; failure: Failure };

export type { ProblemTone, ProblemGuidance } from "$lib/diagnostics/guidance.ts";

const WHOIS_ENDPOINT = "/api/v1/whois";

/**
 * Whether an RDAP result carries any registration field worth showing. A non-existent domain does
 * NOT error under RDAP — it returns `source: "rdap"` with every field empty — so this is how a
 * found record is told apart from a blank one. An empty array counts as absent.
 */
export function hasRegistrationDetail(result: WhoisResult): boolean {
  return Boolean(
    result.registrar ||
    result.registeredAt ||
    result.expiresAt ||
    result.lastChangedAt ||
    result.registrant ||
    (result.nameservers && result.nameservers.length > 0) ||
    (result.statuses && result.statuses.length > 0),
  );
}

/**
 * Classify a 200 body into the state the page renders. The legacy port-43 path always returns
 * unparsed `raw` text; RDAP returns structure, or nothing at all for an unregistered target.
 */
export function classifyResult(result: WhoisResult): "rdap" | "raw" | "empty" {
  if (result.source === "whois-43") return "raw";
  return hasRegistrationDetail(result) ? "rdap" : "empty";
}

/**
 * Human guidance for a failed lookup. The shared presenter ($lib/diagnostics/guidance.ts) supplies
 * the floor — the service-skew 404, the "not a verdict" 429, the server-fault band — and this
 * function overrides only the statuses whose meaning is REGISTRY semantics rather than platform
 * semantics, which no shared default could know.
 *
 * It deliberately never echoes the query or any resolved address: the 400 is generic on purpose —
 * the worker route (apps/api-worker/src/http/routes/tools/whois.ts) keeps it that way as an SSRF guard, and the
 * UI must not undo that by reflecting the input back.
 */
export function problemGuidance(problem: WhoisProblem): ProblemGuidance {
  const base = guidanceForProblem(problem, "The lookup");

  // EVERY 404 goes back untouched, because the shared presenter tells the two apart and this
  // function cannot: one answered by no route at all is deploy skew, one carrying a problem
  // document is a record that is genuinely gone. Returning early matters — the input-fault default
  // below would otherwise clobber both and tell the member their domain was malformed because a
  // release was still rolling out.
  if (problem.status === 404) return base;

  // 501 is checked before the server-fault band it sits in: the registry simply publishes no
  // machine-readable lookup (no RDAP entry, no known port-43 host), which is the ordinary answer
  // for roughly a sixth of the TLD list. Nothing went wrong, so nothing is worth quoting to support,
  // and there is nothing to retry.
  if (problem.status === 501) {
    return {
      ...base,
      tone: "info",
      title: "This registry cannot be looked up",
      message:
        "That domain's registry does not publish a lookup service this tool can reach. Check the registry's own WHOIS page directly.",
      remedy: { kind: "none" },
    };
  }
  // 502 is the registry itself rate-limiting or being away — transient and retryable, so it is
  // separated from the server-fault band before the band is checked: an upstream hiccup is not a
  // fault worth quoting to support, and before this branch existed it read as "no registration
  // record found", which the very next retry contradicted.
  if (problem.status === 502) {
    return {
      ...base,
      tone: "warning",
      title: "The registry did not answer",
      message:
        "The registry's lookup service is rate-limiting or unavailable. It was tried several times automatically; wait a moment, then look up again.",
    };
  }
  if (problem.status >= 500) {
    return {
      ...base,
      tone: "danger",
      title: "The lookup failed",
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
          "WHOIS lookups run against an authenticated session. In local development there is no session yet, so the lookup returns nothing.",
      };
    case 403:
      return {
        ...base,
        tone: "warning",
        title: "You do not have permission",
        message: "Your account is not allowed to run WHOIS lookups.",
      };
    case 429:
      return {
        ...base,
        tone: "warning",
        title: "Too many lookups",
        message: "You have run several lookups in a short time. Wait a moment, then try again.",
      };
    default:
      // 400 (invalid/blocked target) and 422 (the query failed validation) — both are input faults,
      // and neither is fixed by pressing anything on this screen.
      return {
        ...base,
        tone: "warning",
        title: "That is not something this tool can look up",
        message:
          "Enter a domain name (example.com) or an IP address. Private, local, and internal addresses are not accepted.",
        remedy: { kind: "none" },
      };
  }
}

/*
 * A registry timestamp for display. An unparseable value comes back unchanged — `formatInstant`'s
 * own rule, and the right one here: showing exactly what the registry sent is more honest than
 * dropping a field we could not parse.
 */
export { formatInstant as formatTimestamp } from "@magna-carta/design-system/formatters";

/** The attempt now running, reported to the page so the retrying is visible, never silent. */
export interface AttemptProgress {
  attempt: number; // 1-based
  maxAttempts: number;
}

export const LOOKUP_MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1500, 3000]; // before attempt 2, before attempt 3

/**
 * Only faults that a fresh attempt can plausibly clear are retried: the registry itself
 * rate-limiting or away (the 502 the worker maps RdapUpstreamFailure to), and nothing answering
 * at all. Our own platform's 429 is deliberately NOT here — retrying into a member-facing rate
 * limit digs the hole deeper — and every other problem is an answer, not a fault.
 */
function isTransientFault(outcome: WhoisOutcome): boolean {
  if (outcome.kind === "transport") return true;
  return outcome.kind === "problem" && outcome.problem.status === 502;
}

/**
 * Run a lookup with bounded automatic retries on transient upstream faults, reporting each
 * attempt through `onAttempt` so the page can show the process instead of a silent stall
 * (docs/conventions/design-corrections.md, "Retry a transient upstream fault yourself, visibly").
 * Returns the first non-transient outcome, or the last transient one once attempts are exhausted.
 * `delayImpl` is injectable so tests run without real waits.
 */
export async function lookupWhoisWithRetries(
  query: string,
  onAttempt: (progress: AttemptProgress) => void,
  fetchImpl: typeof fetch = fetch,
  delayImpl: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<WhoisOutcome> {
  let outcome: WhoisOutcome = {
    kind: "transport",
    failure: { problem: null, request: requestLine("GET", WHOIS_ENDPOINT), failedAt: new Date() },
  };
  for (let attempt = 1; attempt <= LOOKUP_MAX_ATTEMPTS; attempt += 1) {
    onAttempt({ attempt, maxAttempts: LOOKUP_MAX_ATTEMPTS });
    outcome = await lookupWhois(query, fetchImpl);
    if (!isTransientFault(outcome)) return outcome;
    if (attempt < LOOKUP_MAX_ATTEMPTS) {
      await delayImpl(RETRY_DELAYS_MS[attempt - 1] ?? 3000);
    }
  }
  return outcome;
}

/**
 * Run a WHOIS lookup for a domain or IP. `fetchImpl` is injectable so the branching is testable
 * without the network. Never throws: a thrown fetch (nothing answered) is reported as `transport`,
 * distinct from a server that answered with an error document.
 */
export async function lookupWhois(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WhoisOutcome> {
  const target = query.trim();
  const url = `${WHOIS_ENDPOINT}?query=${encodeURIComponent(target)}`;
  // The request line never carries the query — requestLine drops it, which on this surface matters
  // twice over: the worker route keeps its refusals generic as an SSRF guard, and a copyable trace
  // block is exactly where a reflected target would leak back out.
  const line = requestLine("GET", WHOIS_ENDPOINT);

  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { accept: "application/json" } });
  } catch {
    return { kind: "transport", failure: { problem: null, request: line, failedAt: new Date() } };
  }

  if (!response.ok) {
    const problem = await readProblem(response);
    return { kind: "problem", problem, failure: { problem, request: line, failedAt: new Date() } };
  }

  let result: WhoisResult;
  try {
    result = (await response.json()) as WhoisResult;
  } catch {
    return { kind: "transport", failure: { problem: null, request: line, failedAt: new Date() } };
  }

  return { kind: classifyResult(result), result };
}
